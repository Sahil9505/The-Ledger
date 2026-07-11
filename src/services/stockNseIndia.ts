import { NseIndia } from "stock-nse-india";
import type { ChartPoint } from "../agent/state";
import type { FinancialData } from "../agent/state";

const nseClient = new NseIndia();

function isNseExchange(exchange: string | null | undefined): boolean {
  if (!exchange) return false;
  const upper = exchange.toUpperCase();
  return upper.includes("NSE") || upper.includes("NATIONAL STOCK EXCHANGE") || upper === "NSI";
}

function isBseExchange(exchange: string | null | undefined): boolean {
  if (!exchange) return false;
  const upper = exchange.toUpperCase();
  return upper.includes("BSE") || upper.includes("BOMBAY");
}

export function isIndianExchange(exchange: string | null | undefined): boolean {
  return isNseExchange(exchange) || isBseExchange(exchange);
}

function toIndianSymbol(ticker: string): string {
  return ticker.replace(/\.(NS|BO)$/i, "").trim();
}

export async function tryNseChart(
  ticker: string,
  exchange: string | null | undefined
): Promise<{ points: ChartPoint[]; source: string } | null> {
  if (!isIndianExchange(exchange)) return null;

  try {
    const symbol = toIndianSymbol(ticker);
    const nowDate = new Date();
    const oneYearAgo = new Date(nowDate.getTime() - 365 * 24 * 60 * 60 * 1000);
    const result = await nseClient.getEquityChartHistoricalData(symbol, {
      start: oneYearAgo,
      end: nowDate,
    });

    if (!result?.data?.length) return null;

    const points: ChartPoint[] = result.data
      .filter((c) => c.close != null && c.time != null)
      .map((c) => ({
        date: new Date(c.time).toISOString().slice(0, 10),
        close: c.close,
      }));

    if (!points.length) return null;

    return { points, source: "stock-nse-india chart" };
  } catch (err) {
    console.warn(`stock-nse-india chart failed for ${ticker}:`, (err as Error).message);
    return null;
  }
}

export async function tryNseFundamentals(
  ticker: string,
  exchange: string | null | undefined
): Promise<FinancialData | null> {
  if (!isIndianExchange(exchange)) return null;

  try {
    const symbol = toIndianSymbol(ticker);
    const details = await nseClient.getEquityDetails(symbol);

    if (!details) return null;

    const priceInfo = details.priceInfo;
    const securityInfo = details.securityInfo;
    const metadata = details.metadata;

    const marketCap = priceInfo?.lastPrice != null && securityInfo?.issuedSize != null
      ? priceInfo.lastPrice * securityInfo.issuedSize
      : null;

    return {
      marketCap,
      enterpriseValue: null,
      trailingPE: metadata?.pdSymbolPe != null && metadata.pdSymbolPe > 0 ? metadata.pdSymbolPe : null,
      forwardPE: null,
      revenueTTM: null,
      revenueGrowthYoY: null,
      netProfitMargin: null,
      debtToEquity: null,
      fiftyTwoWeekHigh: priceInfo?.weekHighLow?.max ?? null,
      fiftyTwoWeekLow: priceInfo?.weekHighLow?.min ?? null,
      currency: "INR",
      source: "stock-nse-india equityDetails",
    };
  } catch (err) {
    console.warn(`stock-nse-india fundamentals failed for ${ticker}:`, (err as Error).message);
    return null;
  }
}

export { isNseExchange, isBseExchange };
