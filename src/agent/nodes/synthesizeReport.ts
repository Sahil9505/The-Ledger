import { askForJSON } from "../../services/llm";
import { now, logNodeDuration } from "../../services/timeout";
import type {
  AgentStateType,
  Report,
  SearchResult,
  MarketDataUnavailable,
  MarketData,
  FinancialData,
  TraceEntry,
} from "../state";

function compactSources(results: SearchResult[] = []): string {
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}`)
    .join("\n\n");
}

function summarizeChart(chart: MarketData | undefined): Record<string, unknown> {
  if (!chart || chart.status !== "available") {
    return {
      status: "unavailable",
      reason: chart && "reason" in chart ? (chart as MarketDataUnavailable).reason : "Unavailable",
    };
  }
  return {
    status: "available",
    ticker: chart.ticker,
    currency: chart.currency,
    period: chart.period,
    startClose: chart.startClose,
    endClose: chart.endClose,
    high: chart.high,
    low: chart.low,
    percentChange: chart.percentChange,
    trendLabel: chart.trendLabel,
    source: chart.source,
  };
}

function formatFinancialMetrics(fd: FinancialData | undefined): string {
  if (!fd) return "No verified financial data available.";
  const cur = fd.currency || "USD";
  const money = (n: number) => formatCompact(n, cur);
  const lines: string[] = [];
  if (fd.marketCap != null) lines.push(`Market Cap: ${money(fd.marketCap)}`);
  if (fd.trailingPE != null) lines.push(`Trailing P/E: ${fd.trailingPE.toFixed(2)}`);
  if (fd.forwardPE != null) lines.push(`Forward P/E: ${fd.forwardPE.toFixed(2)}`);
  if (fd.revenueTTM != null) lines.push(`Revenue (TTM): ${money(fd.revenueTTM)}`);
  if (fd.revenueGrowthYoY != null)
    lines.push(`Revenue Growth (YoY): ${fd.revenueGrowthYoY >= 0 ? "+" : ""}${fd.revenueGrowthYoY.toFixed(2)}%`);
  if (fd.netProfitMargin != null)
    lines.push(`Net Profit Margin: ${fd.netProfitMargin >= 0 ? "+" : ""}${fd.netProfitMargin.toFixed(2)}%`);
  if (fd.debtToEquity != null) lines.push(`Debt / Equity: ${fd.debtToEquity.toFixed(2)}`);
  if (fd.fiftyTwoWeekHigh != null) lines.push(`52-Week High: ${money(fd.fiftyTwoWeekHigh)}`);
  if (fd.fiftyTwoWeekLow != null) lines.push(`52-Week Low: ${money(fd.fiftyTwoWeekLow)}`);
  lines.push(`Source: ${fd.source}`);
  return lines.join("\n");
}

function formatCompact(n: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toLocaleString("en-US")}`;
  }
}

function buildKeyMetrics(fd: FinancialData | undefined): Report["keyMetrics"] {
  return {
    marketCap: fd?.marketCap ?? null,
    peRatio: fd?.trailingPE ?? null,
    revenueTTM: fd?.revenueTTM ?? null,
    revenueGrowthYoY: fd?.revenueGrowthYoY ?? null,
    netMargin: fd?.netProfitMargin ?? null,
    week52High: fd?.fiftyTwoWeekHigh ?? null,
    week52Low: fd?.fiftyTwoWeekLow ?? null,
    currency: fd?.currency ?? undefined,
  };
}

// ---- Stable, data-derived confidence (never from the LLM) ----
function computeConfidence(state: AgentStateType): number {
  let score = 50;
  if (state.financialData) {
    const fd = state.financialData;
    if (fd.marketCap != null) score += 10;
    if (fd.revenueTTM != null) score += 10;
    if (fd.trailingPE != null) score += 5;
    if (fd.netProfitMargin != null) score += 5;
  }
  if (state.marketData?.status === "available") score += 10;
  // STABLE signal: did we get ANY web source? (boolean, not a raw count)
  const research = state.researchResults;
  const totalSources =
    (research?.overviewResults?.length || 0) +
    (research?.newsResults?.length || 0) +
    (research?.financialResults?.length || 0);
  score += totalSources > 0 ? 10 : 0;
  return Math.min(Math.max(score, 0), 100);
}

// Human-readable, stable rationale for the confidence score.
function computeConfidenceRationale(state: AgentStateType): string[] {
  const reasons: string[] = [];
  const fd = state.financialData;
  if (fd) {
    if (fd.marketCap != null) reasons.push(`Market cap verified (${formatCompact(fd.marketCap, fd.currency)}).`);
    if (fd.revenueTTM != null) reasons.push(`Trailing revenue verified (${formatCompact(fd.revenueTTM, fd.currency)}).`);
    if (fd.trailingPE != null) reasons.push(`Valuation verified (P/E ${fd.trailingPE.toFixed(1)}).`);
    if (fd.netProfitMargin != null)
      reasons.push(`Profitability verified (${fd.netProfitMargin >= 0 ? "+" : ""}${fd.netProfitMargin.toFixed(1)}% net margin).`);
  }
  if (state.marketData?.status === "available") {
    const c = state.marketData;
    reasons.push(`1-year price trend ${c.percentChange >= 0 ? "+" : ""}${c.percentChange}% (${c.trendLabel}).`);
  }
  const research = state.researchResults;
  const totalSources =
    (research?.overviewResults?.length || 0) +
    (research?.newsResults?.length || 0) +
    (research?.financialResults?.length || 0);
  if (totalSources > 0) reasons.push(`${totalSources} web source(s) reviewed.`);
  if (reasons.length === 0) reasons.push("No verified financial or price data was available — confidence is low.");
  return reasons;
}

// Data-quality tier used by the UI badge.
function computeDataQuality(state: AgentStateType): "strong" | "partial" | "limited" {
  const fd = state.financialData;
  const hasMarket = state.marketData?.status === "available";
  const fdPoints = fd
    ? [fd.marketCap, fd.revenueTTM, fd.trailingPE, fd.netProfitMargin, fd.fiftyTwoWeekHigh].filter(
        (v) => v != null
      ).length
    : 0;
  if (hasMarket && fdPoints >= 3) return "strong";
  if (hasMarket || fdPoints >= 1) return "partial";
  return "limited";
}

// ---- Fallbacks (used when the LLM is unavailable: free-tier rate limit) ----
function buildCompanyOverview(state: AgentStateType): Report["companyOverview"] {
  const company = state.resolvedCompany || {};
  const fd = state.financialData;
  return {
    whatItDoes: "Assessment based on verified market and financial data.",
    foundedYear: "unavailable",
    headquarters: (company as Record<string, unknown>)?.headquarters as string || "unavailable",
    briefHistory: fd
      ? "Verified financials were available from Yahoo Finance."
      : "Financial data providers were unavailable.",
  };
}

function buildDataDrivenReport(state: AgentStateType): Report {
  const fd = state.financialData;
  const chart = state.marketData?.status === "available" ? state.marketData : null;

  const bull: string[] = [];
  const bear: string[] = [];

  if (fd) {
    if (fd.revenueTTM != null && fd.revenueGrowthYoY != null && fd.revenueGrowthYoY >= 0) {
      bull.push(`Revenue of ${formatCompact(fd.revenueTTM, fd.currency)} with ${fd.revenueGrowthYoY >= 0 ? "+" : ""}${fd.revenueGrowthYoY.toFixed(1)}% YoY growth.`);
    } else if (fd.revenueTTM != null) {
      bull.push(`Substantial revenue base of ${formatCompact(fd.revenueTTM, fd.currency)}.`);
    }
    if (fd.netProfitMargin != null && fd.netProfitMargin > 0) {
      bull.push(`Profitable, with a ${fd.netProfitMargin.toFixed(1)}% net margin.`);
    }
    if (fd.marketCap != null) bull.push(`Established market capitalization of ${formatCompact(fd.marketCap, fd.currency)}.`);
    if (fd.trailingPE != null && fd.trailingPE > 30) {
      bear.push(`Rich valuation at ${fd.trailingPE.toFixed(1)}x trailing earnings.`);
    }
    if (fd.debtToEquity != null && fd.debtToEquity > 1.5) {
      bear.push(`Elevated leverage (debt/equity ${fd.debtToEquity.toFixed(2)}).`);
    }
  }
  if (chart) {
    if (chart.percentChange >= 0) bull.push(`Share price up ${chart.percentChange.toFixed(1)}% over the past year.`);
    else bear.push(`Share price down ${Math.abs(chart.percentChange).toFixed(1)}% over the past year.`);
  }
  if (bull.length === 0) bull.push("Limited verified financial data was available to support a bull case.");
  if (bear.length === 0) bear.push("No major red flags surfaced from the verified financial data.");

  const invest =
    !!fd &&
    (fd.revenueGrowthYoY != null ? fd.revenueGrowthYoY >= 0 : true) &&
    (fd.netProfitMargin != null ? fd.netProfitMargin > 0 : true) &&
    fd.marketCap != null;

  const confidence = computeConfidence(state);
  const trendTxt = chart ? ` (1Y trend ${chart.percentChange >= 0 ? "+" : ""}${chart.percentChange}%)` : "";
  const capTxt = fd?.marketCap != null ? ` (market cap ${formatCompact(fd.marketCap, fd.currency)})` : "";
  const executiveSummary = `Generated from verified market data${trendTxt} and Yahoo Finance fundamentals${capTxt}. LLM synthesis was unavailable (rate-limited), so this is a transparent rules-based assessment derived directly from the numbers above.`;

  return {
    companyOverview: buildCompanyOverview(state),
    executiveSummary,
    bullCase: bull,
    bearCase: bear,
    decision: { decision: invest ? "INVEST" : "PASS", confidence, reasoning: [executiveSummary] },
    keyMetrics: buildKeyMetrics(fd),
    confidenceRationale: computeConfidenceRationale(state),
    dataQuality: computeDataQuality(state),
  };
}

// ---- Insufficient-data report (honest empty state) ----
// When we have neither verified financials nor a price chart, no investment
// call can be responsibly made. Previously this produced a misleading 0%
// verdict with no reasoning; now we say so explicitly.
function hasEnoughDataForCall(state: AgentStateType): boolean {
  const fd = state.financialData;
  const fdHasData =
    !!fd &&
    [fd.marketCap, fd.revenueTTM, fd.trailingPE, fd.netProfitMargin, fd.fiftyTwoWeekHigh].some(
      (v) => v != null
    );
  const marketHasData = state.marketData?.status === "available";
  return fdHasData || marketHasData;
}

function buildInsufficientDataReport(state: AgentStateType): Report {
  return {
    companyOverview: buildCompanyOverview(state),
    executiveSummary:
      "We could not retrieve verified financial or price data for this company, so no investment call is being made. This usually means the free data provider rate-limited the request or the ticker isn't available on the free source — not that the company is a bad investment.",
    bullCase: [],
    bearCase: [],
    decision: {
      decision: "PASS",
      confidence: 0,
      reasoning: [
        "Insufficient verified data: no financial fundamentals and no price history were available to base a call on.",
      ],
    },
    keyMetrics: buildKeyMetrics(state.financialData),
    confidenceRationale: [
      "No verified financial or price data was available — the report is intentionally not making a call.",
    ],
    dataQuality: "limited",
  };
}

export async function synthesizeReport(
  state: AgentStateType
): Promise<{
  report: Report;
  marketData: MarketData | undefined;
  trace: TraceEntry[];
}> {
  const start = now();
  const confidence = computeConfidence(state);
  const company = state.resolvedCompany || {};
  const overviewSources = compactSources(state.researchResults?.overviewResults);
  const newsSources = compactSources(state.researchResults?.newsResults);
  const financialSources = compactSources(state.researchResults?.financialResults);
  const verifiedFinancials = formatFinancialMetrics(state.financialData);

  let result: Report;

  try {
    result = (await askForJSON(
      `You are a disciplined investment research analyst. Write for an informed reader; be specific and tie every claim to the verified data block.`,
      `Company:
${JSON.stringify(company, null, 2)}

Chart summary:
${JSON.stringify(summarizeChart(state.marketData), null, 2)}

==== VERIFIED FINANCIAL DATA ====
${verifiedFinancials}

Use the block above for ALL numeric claims (market cap, revenue, margins, P/E, growth rates, etc.). Do NOT rely on web search snippets for numbers — they may be stale or inaccurate. The overall data confidence score is ${confidence}/100 — factor this into your reasoning.

==== WEB SEARCH SOURCES (qualitative context only) ====
Company profile sources:
${overviewSources || "No sources found."}
News sources:
${newsSources || "No sources found."}
Financial sources:
${financialSources || "No sources found."}

Return ONLY valid JSON with exactly these keys:
{
  "companyOverview": {
    "whatItDoes": "short summary or 'unavailable'",
    "foundedYear": "year or 'unavailable'",
    "headquarters": "location or 'unavailable'",
    "briefHistory": "2-3 sentence summary or 'unavailable'"
  },
  "executiveSummary": "2-3 sentence analytical lead: what the verified data says and the gist of the call",
  "bullCase": ["evidence-based reason 1", "reason 2", "reason 3"],
  "bearCase": ["evidence-based reason 1", "reason 2", "reason 3"],
  "decision": {
    "decision": "INVEST" or "PASS",
    "confidence": ${confidence},
    "reasoning": ["reason 1", "reason 2", "reason 3"]
  }
}`,
      { temperature: 0, timeoutMs: 8000 }
    )) as unknown as Report;

    result.keyMetrics = buildKeyMetrics(state.financialData);
    result.confidenceRationale = computeConfidenceRationale(state);
    result.dataQuality = computeDataQuality(state);

    // The LLM returned something structurally unusable (e.g. a malformed
    // object missing a decision) — fall back to the rules-based builder
    // rather than emitting a broken report.
    if (!result || !result.decision || !Array.isArray(result.decision?.reasoning)) {
      result = buildDataDrivenReport(state);
    }
  } catch {
    console.warn("synthesizeReport LLM call failed — building rules-based fallback report");
    result = buildDataDrivenReport(state);
  }

  // If we genuinely have no verified numbers or price action to reason from,
  // present that honestly instead of a misleading 0% verdict.
  if (!hasEnoughDataForCall(state)) {
    result = buildInsufficientDataReport(state);
  }

  logNodeDuration("synthesizeReport", start);

  return {
    report: result,
    marketData: state.marketData,
    trace: [
      {
        step: "Synthesize Report",
        detail: `Final call: ${result.decision?.decision} (confidence ${result.decision?.confidence}%). ${result.dataQuality ? `Data quality: ${result.dataQuality}.` : ""}`,
      },
    ],
  };
}
