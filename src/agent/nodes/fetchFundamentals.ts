import { fetchFundamentals as fetchFundamentalsService } from "../../services/fundamentals";
import { now, logNodeDuration } from "../../services/timeout";
import type { AgentStateType, FinancialData, TraceEntry } from "../state";

export async function fetchFundamentals(
  state: AgentStateType
): Promise<{
  financialData: FinancialData;
  trace: TraceEntry[];
}> {
  const start = now();
  const data = await fetchFundamentalsService(
    state.resolvedTicker || null,
    state.resolvedCompany?.exchange ?? null
  );
  logNodeDuration("fetchFundamentals", start);

  const hasData = data.marketCap != null || data.revenueTTM != null || data.trailingPE != null;

  return {
    financialData: data,
    trace: [
      {
        step: "Fetch Fundamentals",
        detail: hasData
          ? `Loaded verified financials for ${state.resolvedTicker} (source: ${data.source}): ${data.marketCap != null ? `MCap ${formatCompact(data.marketCap)}` : "MCap N/A"}${data.trailingPE != null ? `, P/E ${data.trailingPE.toFixed(1)}` : ""}.`
          : `Financial data unavailable: ${data.source}`,
      },
    ],
  };
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString("en-US")}`;
}
