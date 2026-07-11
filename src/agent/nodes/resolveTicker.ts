import { resolveTicker as resolveTickerService } from "../../services/ticker";
import type { AgentStateType, TraceEntry } from "../state";

export async function resolveTickerNode(
  state: AgentStateType
): Promise<{
  resolvedTicker: string;
  resolvedSuffix: string | null;
  trace: TraceEntry[];
}> {
  const { ticker, exchange } = state.resolvedCompany || {};
  const result = await resolveTickerService(ticker || null, exchange);

  // A resolve is only a success if we started from a real ticker AND got back
  // a real one. PRIVATE/UNKNOWN inputs (and bare null) must not be
  // reported as "resolved".
  const inputUnresolvable =
    !ticker || ticker === "PRIVATE" || ticker === "UNKNOWN";
  const resolvedReal =
    !!result.resolved && result.resolved !== "PRIVATE" && result.resolved !== "UNKNOWN";
  const succeeded = !inputUnresolvable && resolvedReal;

  return {
    resolvedTicker: result.resolved,
    resolvedSuffix: result.suffixUsed,
    trace: [
      {
        step: "Resolve Ticker",
        detail: succeeded
          ? `Resolved ${ticker} → ${result.resolved}${result.suffixUsed ? ` (suffix: ${result.suffixUsed})` : ""}.`
          : `Ticker resolution failed for ${ticker}. Tried: ${result.allAttempted.join(", ")} — none resolved.`,
      },
    ],
  };
}
