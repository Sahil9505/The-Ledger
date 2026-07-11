import yahooFinance from "./yahooClient";
import { withTimeout } from "./timeout";

const TICKER_TIMEOUT = 15000;
const EXCHANGE_SUFFIXES: Record<string, string[]> = {
  "NSE": [".NS"],
  "BSE": [".BO"],
  "LSE": [".L"],
  "TSX": [".TO"],
  "XETRA": [".DE"],
  "FRA": [".F"],
  "SWX": [".SW"],
  "HKEX": [".HK"],
  "SGX": [".SI"],
  "TSE": [".T"],
  "EURONEXT": [".PA"],
  "ASX": [".AX"],
  "OMX": [".ST"],
  "KOSPI": [".KS"],
  "KOSDAQ": [".KQ"],
  "SSE": [".SS"],
  "SZSE": [".SZ"],
  "TPEX": [".TWO"],
};

function getSuffixesForExchange(exchange: string | null | undefined): string[] {
  if (!exchange) return [];
  const upper = exchange.toUpperCase();
  for (const [key, suffixes] of Object.entries(EXCHANGE_SUFFIXES)) {
    if (upper.includes(key)) return suffixes;
  }
  if (upper.includes("INDIA")) return [".NS", ".BO"];
  if (upper.includes("LONDON") || upper.includes("UK")) return [".L"];
  if (upper.includes("GERMAN") || upper.includes("FRANKFURT")) return [".DE", ".F"];
  return [];
}

async function tickerResolves(raw: string): Promise<boolean> {
  try {
    await withTimeout(
      yahooFinance.chart(raw, {
        period1: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        interval: "1d",
      }),
      TICKER_TIMEOUT,
      `ticker resolve ${raw}`
    );
    return true;
  } catch {
    return false;
  }
}

export interface TickerResult {
  resolved: string;
  suffixUsed: string | null;
  allAttempted: string[];
}

export async function resolveTicker(
  baseTicker: string | null,
  exchange: string | null | undefined
): Promise<TickerResult> {
  const trimmed = String(baseTicker || "").trim();
  if (!trimmed || trimmed === "PRIVATE" || trimmed === "UNKNOWN") {
    return { resolved: trimmed, suffixUsed: null, allAttempted: [trimmed] };
  }

  const suffixes = getSuffixesForExchange(exchange);
  const candidates: string[] = [];

  for (const s of suffixes) {
    if (!trimmed.endsWith(s)) {
      candidates.push(`${trimmed}${s}`);
    }
  }
  candidates.push(trimmed);

  for (const candidate of candidates) {
    if (await tickerResolves(candidate)) {
      const suffix = candidate === trimmed ? null : candidate.slice(trimmed.length);
      return { resolved: candidate, suffixUsed: suffix, allAttempted: candidates };
    }
  }

  return { resolved: trimmed, suffixUsed: null, allAttempted: candidates };
}
