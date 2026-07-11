import yahooFinance from "@/services/yahooClient";
import { NextRequest } from "next/server";
import { getGraph } from "@/agent/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 10s by default; the agent pipeline can take
// up to its internal 30s deadline, so allow the full 60s (Hobby maximum).
export const maxDuration = 60;

interface CacheEntry {
  result: Record<string, unknown>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000;

function getCached(key: string): Record<string, unknown> | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(key: string, result: Record<string, unknown>): void {
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

function encodeSSE(data: unknown, event?: string): string {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  return event ? `event: ${event}\n${payload}` : payload;
}

let warmedUp = false;
async function warmupYahooFinance(): Promise<void> {
  if (warmedUp) return;
  try {
    await yahooFinance.chart("AAPL", {
      period1: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      interval: "1d",
    });
    warmedUp = true;
    console.log("[warmup] yahoo-finance2 session initialized");
  } catch (err) {
    console.warn(
      "[warmup] yahoo-finance2 session init failed (will retry on first real call):",
      (err as Error).message,
    );
  }
}
warmupYahooFinance();

export async function POST(request: NextRequest) {
  const totalStart = Date.now();

  try {
    const body = (await request.json()) as { companyName?: string } | undefined;
    const companyName = body?.companyName;

    if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
      return new Response(encodeSSE({ error: "companyName is required." }), {
        status: 400,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    const key = companyName.trim().toLowerCase();
    const cached = getCached(key);
    if (cached) {
      const stream = new ReadableStream({
        start(controller) {
          const traces = (cached.trace as Array<{ step: string; detail: string }>) || [];
          for (const entry of traces) {
            controller.enqueue(
              new TextEncoder().encode(encodeSSE({ type: "trace", entry }, "trace"))
            );
          }
          controller.enqueue(
            new TextEncoder().encode(encodeSSE({ type: "result", data: cached }, "result"))
          );
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const agent = getGraph();
    const input = { companyName: companyName.trim(), trace: [] };

    // Global latency budget (free-tier: keep the experience bounded even if a
    // provider or the LLM is slow). Per-call timeouts live in the services.
    const DEADLINE_MS = 30000;
    const deadline = Date.now() + DEADLINE_MS;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let finalState: Record<string, unknown> | null = null;
          let seenTraces = 0;
          let timedOut = false;

          for await (const state of await agent.stream(input, { streamMode: "values" })) {
            if (Date.now() > deadline) {
              timedOut = true;
              break;
            }
            const typedState = state as Record<string, unknown>;
            finalState = typedState;

            const traceEntries = (typedState.trace || []) as Array<{ step: string; detail: string }>;
            const newEntries = traceEntries.slice(seenTraces);
            seenTraces = traceEntries.length;

            for (const entry of newEntries) {
              controller.enqueue(
                new TextEncoder().encode(encodeSSE({ type: "trace", entry }, "trace"))
              );
            }
          }

          if (timedOut && !finalState) {
            controller.enqueue(
              new TextEncoder().encode(
                encodeSSE({ type: "error", error: "Analysis exceeded the time budget." })
              )
            );
            controller.close();
            return;
          }

          if (!finalState) {
            controller.enqueue(
              new TextEncoder().encode(
                encodeSSE({ type: "error", error: "Agent returned no state." })
              )
            );
            controller.close();
            return;
          }

          const result: Record<string, unknown> = {
            companyName: finalState.companyName,
            resolvedCompany: finalState.resolvedCompany,
            companyValidation: finalState.companyValidation,
            report: finalState.report,
            marketData: finalState.marketData,
            financialData: finalState.financialData,
            trace: finalState.trace,
            sources: {
              overview: (finalState.researchResults as Record<string, unknown> | undefined)
                ?.overviewResults,
              news: (finalState.researchResults as Record<string, unknown> | undefined)
                ?.newsResults,
              financials: (finalState.researchResults as Record<string, unknown> | undefined)
                ?.financialResults,
            },
          };

          setCache(key, result);

          const totalDuration = Date.now() - totalStart;
          console.log(`[timing] TOTAL PIPELINE: ${totalDuration}ms`);

          controller.enqueue(
            new TextEncoder().encode(encodeSSE({ type: "result", data: result }, "result"))
          );
          controller.close();
        } catch (err) {
          const error = err as Error & { statusCode?: number };
          console.error(error);
          controller.enqueue(
            new TextEncoder().encode(
              encodeSSE({
                type: "error",
                error: error.message || "Agent run failed.",
                statusCode: error.statusCode || 500,
              })
            )
          );
          controller.close();

          const totalDuration = Date.now() - totalStart;
          console.log(`[timing] TOTAL PIPELINE (failed): ${totalDuration}ms`);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    console.error(error);
    return new Response(encodeSSE({ error: error.message || "Agent run failed." }), {
      status: error.statusCode || 500,
      headers: { "Content-Type": "text/event-stream" },
    });
  }
}
