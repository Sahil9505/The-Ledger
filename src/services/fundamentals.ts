import yahooFinance from "./yahooClient";
import { tryNseFundamentals, isIndianExchange } from "./stockNseIndia";
import { withTimeout } from "./timeout";
import { loadDiskCache, persistCache } from "./cache";
import type { FinancialData } from "../agent/state";

const FETCH_TIMEOUT = 8000;
const CACHE_FILE = "fund-cache.json";

interface CacheEntry {
  data: FinancialData;
  expiresAt: number;
}

const fundCache = new Map<string, CacheEntry>();
const CACHE_TTL = 15 * 60 * 1000;

(function loadDiskCacheIntoMemory() {
  const disk = loadDiskCache<FinancialData>(CACHE_FILE);
  if (disk) {
    for (const [key, entry] of disk) {
      fundCache.set(key, entry);
    }
    console.log(`[cache] Restored ${fundCache.size} fundamentals entries from disk`);
  }
})();

function getCached(ticker: string): FinancialData | null {
  const entry = fundCache.get(ticker);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { fundCache.delete(ticker); return null; }
  return entry.data;
}

function setCache(ticker: string, data: FinancialData): void {
  fundCache.set(ticker, { data, expiresAt: Date.now() + CACHE_TTL });
  persistCache(CACHE_FILE, fundCache);
}

function buildUnavailable(source: string): FinancialData {
  return {
    marketCap: null, enterpriseValue: null, trailingPE: null, forwardPE: null,
    revenueTTM: null, revenueGrowthYoY: null, netProfitMargin: null, debtToEquity: null,
    fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, currency: "USD", source,
  };
}

function mapYahooResult(result: Record<string, any>): FinancialData {
  const fin = result.financialData || {};
  const detail = result.summaryDetail || {};
  const stats = result.defaultKeyStatistics || {};
  const price = result.price || {};
  const incomeHistory = result.incomeStatementHistory?.incomeStatementHistory;
  const revenueTTM = fin.totalRevenue ?? null;
  const netIncome = incomeHistory?.[0]?.netIncome ?? null;
  const netMargin =
    revenueTTM && netIncome != null && revenueTTM > 0
      ? Math.round((netIncome / revenueTTM) * 10000) / 100
      : fin.profitMargins != null
        ? Math.round(fin.profitMargins * 10000) / 100
        : null;
  // yahoo v3 dropped the old `.raw`/`.fmt` wrappers — values are now
  // returned directly. Market cap also moved out of `financialData`.
  const marketCap = price.marketCap ?? detail.marketCap ?? null;
  return {
    marketCap,
    enterpriseValue: stats.enterpriseValue ?? null,
    trailingPE: detail.trailingPE ?? null,
    forwardPE: detail.forwardPE ?? null,
    revenueTTM,
    revenueGrowthYoY:
      fin.revenueGrowth != null ? Math.round(fin.revenueGrowth * 10000) / 100 : null,
    netProfitMargin: netMargin,
    debtToEquity: fin.debtToEquity ?? null,
    fiftyTwoWeekHigh: detail.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: detail.fiftyTwoWeekLow ?? null,
    currency: detail.currency || price.currency || "USD",
    source: "yahoo-finance2 quoteSummary",
  };
}

function mapFMPResult(profile: Record<string, any>): FinancialData {
  return {
    marketCap: profile.marketCap ?? null,
    enterpriseValue: profile.enterpriseValue ?? null,
    trailingPE: profile.pe ?? null,
    forwardPE: profile.forwardPE ?? null,
    revenueTTM: profile.revenue ?? null,
    revenueGrowthYoY: profile.revenueGrowth ?? null,
    netProfitMargin: profile.profitMargin != null ? Math.round(profile.profitMargin * 10000) / 100 : null,
    debtToEquity: profile.debtToEquity ?? null,
    fiftyTwoWeekHigh: profile.weekHigh52 ?? null,
    fiftyTwoWeekLow: profile.weekLow52 ?? null,
    currency: profile.currency || "USD",
    source: "FMP profile",
  };
}

async function tryYahooFundamentals(ticker: string): Promise<FinancialData | null> {
  try {
    const result = await yahooFinance.quoteSummary(ticker, {
      // `price` carries marketCap (yahoo v3 moved it out of financialData)
      modules: ["financialData", "defaultKeyStatistics", "summaryDetail", "incomeStatementHistory", "price"],
    });
    if (!result) return null;
    return mapYahooResult(result as unknown as Record<string, any>);
  } catch (err) {
    console.error(`[fundamentals] yahoo-finance2 quoteSummary failed for ${ticker}:`, err);
    return null;
  }
}

async function tryFmpFundamentals(ticker: string): Promise<FinancialData | null> {
  const key = process.env.FMP_API_KEY;
  if (!key || key === "your_key_here") return null;
  try {
    const url = `https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(ticker)}?apikey=${key}`;
    const controller = new AbortController();
    const res = await withTimeout(fetch(url, { signal: controller.signal }), FETCH_TIMEOUT, `FMP profile ${ticker}`, controller);
    if (!res.ok) return null;
    const data = await res.json() as Record<string, any>[];
    if (!data?.[0]) return null;
    return mapFMPResult(data[0]);
  } catch (err) {
    console.error(`[fundamentals] FMP fundamentals failed for ${ticker}:`, err);
    return null;
  }
}

export async function fetchFundamentals(
  ticker: string | null,
  exchange?: string | null
): Promise<FinancialData> {
  const trimmed = String(ticker || "").trim();
  if (!trimmed || trimmed === "PRIVATE" || trimmed === "UNKNOWN") {
    return buildUnavailable("Ticker not resolved");
  }

  const cached = getCached(trimmed);
  if (cached) return cached;

  const errors: string[] = [];

  const promises: Promise<FinancialData | null>[] = [
    // Primary provider wrapped in a hard timeout so a stalled yahoo session
    // can never hang the whole request.
    withTimeout(tryYahooFundamentals(trimmed), 12000, `yahoo fundamentals ${trimmed}`)
      .catch(() => null)
      .then((r) => {
        if (!r) { errors.push("yahoo-finance2 fundamentals unavailable or timed out"); return null; }
        return r;
      }),
    tryFmpFundamentals(trimmed).then((r) => {
      if (!r) { errors.push("FMP fundamentals returned no data"); return null; }
      return r;
    }),
  ];

  if (exchange != null && isIndianExchange(exchange)) {
    promises.push(
      tryNseFundamentals(trimmed, exchange).then((r) => {
        if (!r) { errors.push("NSE fundamentals returned no data"); return null; }
        return r;
      })
    );
  }

  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === "fulfilled" && r.value != null) {
      const fd = r.value;
      // Don't cache empty/transiently-broken results — otherwise a
      // brief yahoo hiccup gets persisted to disk/memory for the TTL
      // and poisons every subsequent run.
      const hasData = fd.marketCap != null || fd.revenueTTM != null || fd.trailingPE != null;
      if (hasData) setCache(trimmed, fd);
      return fd;
    }
  }

  for (const r of results) {
    if (r.status === "rejected") {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors.push(`provider threw: ${msg}`);
      console.error(`[fundamentals] provider rejected for ${trimmed}:`, r.reason);
    }
  }

  return buildUnavailable(`All fundamentals providers failed for ${trimmed}. ${errors.join("; ")}`);
}
