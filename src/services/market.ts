import yahooFinance from "./yahooClient";
import { tryNseChart, isIndianExchange } from "./stockNseIndia";
import { withTimeout } from "./timeout";
import { loadDiskCache, persistCache } from "./cache";
import type { ChartPoint, MarketData, MarketDataAvailable } from "../agent/state";

const FETCH_TIMEOUT = 8000;
const CACHE_FILE = "chart-cache.json";

interface CacheEntry {
  data: MarketDataAvailable;
  expiresAt: number;
}

const chartCache = new Map<string, CacheEntry>();
const CACHE_TTL = 15 * 60 * 1000;

(function loadDiskCacheIntoMemory() {
  const disk = loadDiskCache<MarketDataAvailable>(CACHE_FILE);
  if (disk) {
    for (const [key, entry] of disk) {
      chartCache.set(key, entry);
    }
    console.log(`[cache] Restored ${chartCache.size} chart entries from disk`);
  }
})();

function getCached(ticker: string): MarketDataAvailable | null {
  const entry = chartCache.get(ticker);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    chartCache.delete(ticker);
    return null;
  }
  return entry.data;
}

function setCache(ticker: string, data: MarketDataAvailable): void {
  chartCache.set(ticker, { data, expiresAt: Date.now() + CACHE_TTL });
  persistCache(CACHE_FILE, chartCache);
}

function samplePoints(points: ChartPoint[], targetCount = 32): ChartPoint[] {
  if (points.length <= targetCount) return points;
  const step = (points.length - 1) / (targetCount - 1);
  const sampled: ChartPoint[] = [];
  for (let i = 0; i < targetCount; i += 1) {
    sampled.push(points[Math.round(i * step)]);
  }
  return sampled;
}

function buildAvailable(
  ticker: string,
  points: ChartPoint[],
  currency: string,
  exchangeName: string | null,
  source: string,
): MarketDataAvailable {
  const firstClose = points[0].close;
  const lastClose = points[points.length - 1].close;
  const high = Math.max(...points.map((p) => p.close));
  const low = Math.min(...points.map((p) => p.close));
  const percentChange = firstClose ? ((lastClose - firstClose) / firstClose) * 100 : 0;

  return {
    status: "available",
    ticker,
    currency,
    exchangeName,
    period: "1y",
    points: samplePoints(points),
    startClose: firstClose,
    endClose: lastClose,
    high,
    low,
    percentChange: Number(percentChange.toFixed(2)),
    trendLabel: percentChange > 2 ? "up" : percentChange < -2 ? "down" : "flat",
    source,
  };
}

async function tryYahooChart(ticker: string): Promise<{ points: ChartPoint[]; currency: string; exchangeName: string | null } | null> {
  try {
    const now = new Date();
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const result = await yahooFinance.chart(ticker, {
      period1: oneYearAgo.toISOString().slice(0, 10),
      interval: "1d",
    }) as unknown as { quotes?: Array<{ date: Date; close: number | null }>; meta?: { currency?: string; exchangeName?: string } };

    if (!result?.quotes?.length) return null;

    const points = result.quotes
      .filter((q) => q.close != null && q.date != null)
      .map((q) => ({ date: new Date(q.date!).toISOString().slice(0, 10), close: q.close! }));

    if (!points.length) return null;

    return {
      points,
      currency: result.meta?.currency || "USD",
      exchangeName: result.meta?.exchangeName || null,
    };
  } catch (err) {
    console.error(`[market] yahoo-finance2 chart failed for ${ticker}:`, err);
    return null;
  }
}

async function tryFmpChart(ticker: string): Promise<{ points: ChartPoint[]; currency: string } | null> {
  const key = process.env.FMP_API_KEY;
  if (!key || key === "your_key_here") return null;
  try {
    const now = Math.floor(Date.now() / 1000);
    const oneYearAgo = now - 365 * 24 * 60 * 60;
    const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(ticker)}?from=${new Date(oneYearAgo * 1000).toISOString().slice(0, 10)}&to=${new Date(now * 1000).toISOString().slice(0, 10)}&apikey=${key}`;
    const controller = new AbortController();
    const res = await withTimeout(fetch(url, { signal: controller.signal }), FETCH_TIMEOUT, `FMP chart ${ticker}`, controller);
    if (!res.ok) return null;
    const data = await res.json() as { historical?: Array<{ date: string; close: number }> };
    if (!data?.historical?.length) return null;

    const points = data.historical
      .filter((q) => q.close != null)
      .map((q) => ({ date: q.date, close: q.close }));

    if (!points.length) return null;

    return { points, currency: "USD" };
  } catch (err) {
    console.error(`[market] FMP chart failed for ${ticker}:`, err);
    return null;
  }
}

export async function fetchStockChart(
  resolvedTicker: string | null,
  exchange?: string | null
): Promise<MarketData> {
  const trimmed = String(resolvedTicker || "").trim();
  if (!trimmed || trimmed === "PRIVATE" || trimmed === "UNKNOWN") {
    return { status: "unavailable", reason: "Ticker is unresolved or the company is not publicly traded." };
  }

  const cached = getCached(trimmed);
  if (cached) return cached;

  const errors: string[] = [];

  const promises: Promise<{ points: ChartPoint[]; currency: string; exchangeName?: string | null; source: string } | null>[] = [
    // Primary provider wrapped in a hard timeout so a stalled yahoo session
    // can never hang the whole request.
    withTimeout(tryYahooChart(trimmed), 12000, `yahoo chart ${trimmed}`)
      .catch(() => null)
      .then((r) => {
        if (!r) { errors.push("yahoo-finance2 chart unavailable or timed out"); return null; }
        return { ...r, source: "yahoo-finance2 chart" };
      }),
    tryFmpChart(trimmed).then((r) => {
      if (!r) { errors.push("FMP chart returned no data"); return null; }
      return { ...r, exchangeName: null, source: "FMP chart" };
    }),
  ];

  if (exchange != null && isIndianExchange(exchange)) {
    promises.push(
      tryNseChart(trimmed, exchange).then((r) => {
        if (!r) { errors.push("NSE chart returned no data"); return null; }
        return { points: r.points, currency: "INR", exchangeName: "NSE", source: r.source };
      })
    );
  }

  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === "fulfilled" && r.value != null) {
      const winner = r.value;
      const available = buildAvailable(trimmed, winner.points, winner.currency, winner.exchangeName ?? null, winner.source);
      setCache(trimmed, available);
      return available;
    }
  }

  for (const r of results) {
    if (r.status === "rejected") {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors.push(`provider threw: ${msg}`);
      console.error(`[market] provider rejected for ${trimmed}:`, r.reason);
    }
  }

  return { status: "unavailable", reason: `All chart providers failed for ${trimmed}. ${errors.join("; ")}` };
}
