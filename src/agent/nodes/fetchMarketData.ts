import { fetchStockChart } from "../../services/market";
import { now, logNodeDuration } from "../../services/timeout";
import type { AgentStateType, MarketData, TraceEntry } from "../state";

export async function fetchMarketData(
  state: AgentStateType
): Promise<{
  marketData: MarketData;
  trace: TraceEntry[];
}> {
  const start = now();
  const chart = await fetchStockChart(
    state.resolvedTicker || null,
    state.resolvedCompany?.exchange ?? null
  );
  logNodeDuration("fetchMarketData", start);

  return {
    marketData: chart,
    trace: [
      {
        step: "Fetch Price Data",
        detail:
          chart.status === "available"
            ? chart.source.includes("stock-nse-india")
              ? `Loaded 1-year price history from NSE India for ${state.resolvedTicker}.`
              : `Loaded 1-year price history for ${state.resolvedTicker} (source: ${chart.source}).`
            : `Price chart unavailable: ${chart.reason}`,
      },
    ],
  };
}
