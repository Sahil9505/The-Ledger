import { askForJSON } from "../../services/llm";
import yahooFinance from "../../services/yahooClient";
import { now, logNodeDuration, withTimeout } from "../../services/timeout";
import type { AgentStateType, CompanyValidation, ResolvedCompany, TraceEntry } from "../state";

const VALIDATION_PROMPT =
  "You are a strict company validator. Only mark recognized=true if the input clearly refers to a real, identifiable company. Be conservative. If the input is a random word, common noun, fictional entity, ticker-only fragment, or too ambiguous to identify confidently, mark recognized=false.";

const VALIDATION_USER = `Input: __INPUT__

Return JSON with exactly these keys:
{
  "recognized": true or false,
  "reason": "short explanation",
  "officialName": "official company name or null",
  "ticker": "public ticker symbol or null",
  "exchange": "primary exchange or null",
  "sector": "sector or null",
  "isPublic": true or false,
  "headquarters": "headquarters or null"
}`;

function companyNotRecognizedError(message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 422;
  return error;
}

// Best-effort fallback used when the LLM is unavailable (free-tier rate limit).
// Resolves the company name to a ticker via Yahoo Finance search (no key, no LLM).
async function resolveViaYahooSearch(
  input: string
): Promise<{ validation: CompanyValidation; company: ResolvedCompany; trace: TraceEntry[] } | null> {
  try {
    const res = (await withTimeout(
      yahooFinance.search(input),
      8000,
      `yahoo search ${input}`
    )) as unknown as {
      quotes?: Array<{
        symbol?: string;
        quoteType?: string;
        shortname?: string;
        longname?: string;
        exchange?: string;
        exchDisp?: string;
        sector?: string;
      }>;
    };
    // Only treat equities/ETFs as companies. Yahoo search also returns crypto,
    // forex and index instruments (e.g. "banana" -> ApeSwap USD), which are not
    // companies and must not be analyzed as stocks.
    const top = (res?.quotes || []).find(
      (q) =>
        !!q.symbol &&
        (!q.quoteType || q.quoteType === "EQUITY" || q.quoteType === "ETF")
    );
    if (!top?.symbol) return null;

    const name = top.shortname || top.longname || top.symbol;
    const exchange =
      top.exchange && top.exchange !== "NMS" && top.exchange !== "N/A"
        ? top.exchange
        : top.exchDisp || "N/A";
    const sector = top.sector || "Unknown";

    const validation: CompanyValidation = {
      recognized: true,
      reason: "Resolved via Yahoo Finance search (LLM validation unavailable — rate-limited).",
      officialName: name,
      ticker: top.symbol,
      exchange,
      sector,
      isPublic: true,
      headquarters: null,
    };

    const company: ResolvedCompany = {
      fullName: name,
      ticker: top.symbol,
      sector,
      exchange,
      headquarters: null,
      isPublic: true,
      recognitionReason: validation.reason,
    };

    return {
      validation,
      company,
      trace: [
        {
          step: "Validate Company",
          detail: `Recognized ${name} (${top.symbol}) via Yahoo search — LLM validation skipped (rate-limited).`,
        },
      ],
    };
  } catch {
    return null;
  }
}

export async function validateCompany(
  state: AgentStateType
): Promise<{
  companyValidation: CompanyValidation;
  resolvedCompany: ResolvedCompany;
  trace: TraceEntry[];
}> {
  const start = now();
  const input = state.companyName;

  let result: CompanyValidation | null = null;
  try {
    result = (await askForJSON(
      VALIDATION_PROMPT,
      VALIDATION_USER.replace("__INPUT__", JSON.stringify(input)),
      { temperature: 0.2, timeoutMs: 8000 }
    )) as unknown as CompanyValidation;
  } catch {
    // LLM unavailable (free-tier quota/availability) — fall through to search.
    result = null;
  }

  // LLM explicitly said it's not a real company: respect that.
  if (result && !result.recognized) {
    throw companyNotRecognizedError(result.reason || "The input is not a recognized company.");
  }
  if (result && !result.officialName) {
    throw companyNotRecognizedError("The input could not be resolved to a recognized company.");
  }

  // Happy path: LLM resolved it.
  if (result) {
    logNodeDuration("validateCompany", start);
    const resolvedCompany: ResolvedCompany = {
      fullName: result.officialName!,
      ticker: result.isPublic ? result.ticker || null : null,
      sector: result.sector || "Unknown",
      exchange: result.exchange || "N/A",
      headquarters: result.headquarters || null,
      isPublic: Boolean(result.isPublic),
      recognitionReason: result.reason,
    };
    return {
      companyValidation: result,
      resolvedCompany,
      trace: [
        {
          step: "Validate Company",
          detail: `Recognized ${result.officialName}${resolvedCompany.ticker ? ` (${resolvedCompany.ticker})` : ""}.`,
        },
      ],
    };
  }

  // Free-tier fallback: resolve from Yahoo search instead of erroring out.
  const fallback = await resolveViaYahooSearch(input);
  if (!fallback) {
    throw companyNotRecognizedError(
      "LLM validation is unavailable (rate-limited) and the company could not be resolved via search."
    );
  }
  logNodeDuration("validateCompany", start);
  return {
    companyValidation: fallback.validation,
    resolvedCompany: fallback.company,
    trace: fallback.trace,
  };
}
