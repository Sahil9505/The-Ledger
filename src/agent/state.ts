import { Annotation } from "@langchain/langgraph";

export interface TraceEntry {
  step: string;
  detail: string;
}

export interface CompanyValidation {
  recognized: boolean;
  reason: string;
  officialName: string | null;
  ticker: string | null;
  exchange: string | null;
  sector: string | null;
  isPublic: boolean;
  headquarters: string | null;
}

export interface ResolvedCompany {
  fullName: string;
  ticker: string | null;
  sector: string;
  exchange: string;
  headquarters: string | null;
  isPublic: boolean;
  recognitionReason: string;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface ResearchResults {
  overviewResults: SearchResult[];
  newsResults: SearchResult[];
  financialResults: SearchResult[];
}

export interface ChartPoint {
  date: string;
  close: number;
}

export interface MarketDataAvailable {
  status: "available";
  ticker: string;
  currency: string;
  exchangeName: string | null;
  period: string;
  points: ChartPoint[];
  startClose: number;
  endClose: number;
  high: number;
  low: number;
  percentChange: number;
  trendLabel: "up" | "down" | "flat";
  source: string;
}

export interface MarketDataUnavailable {
  status: "unavailable";
  reason: string;
}

export type MarketData = MarketDataAvailable | MarketDataUnavailable;

export interface ReportDecision {
  decision: "INVEST" | "PASS";
  confidence: number;
  reasoning: string[];
}

export interface CompanyOverview {
  whatItDoes: string;
  foundedYear: string;
  headquarters: string;
  briefHistory: string;
}

export interface KeyMetrics {
  marketCap: number | null;
  peRatio: number | null;
  revenueTTM: number | null;
  revenueGrowthYoY: number | null;
  netMargin: number | null;
  week52High: number | null;
  week52Low: number | null;
  currency?: string;
}

export interface FinancialData {
  marketCap: number | null;
  enterpriseValue: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  revenueTTM: number | null;
  revenueGrowthYoY: number | null;
  netProfitMargin: number | null;
  debtToEquity: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  currency: string;
  source: string;
}

export interface Report {
  companyOverview: CompanyOverview;
  executiveSummary?: string;
  bullCase: string[];
  bearCase: string[];
  decision: ReportDecision;
  keyMetrics?: KeyMetrics;
  confidenceRationale?: string[];
  dataQuality?: "strong" | "partial" | "limited";
}

export interface AgentStateType {
  companyName: string;
  companyValidation?: CompanyValidation;
  resolvedCompany?: ResolvedCompany;
  resolvedTicker?: string;
  resolvedSuffix?: string | null;
  researchResults?: ResearchResults;
  marketData?: MarketData;
  financialData?: FinancialData;
  report?: Report;
  trace: TraceEntry[];
}

export const AgentState = Annotation.Root({
  companyName: Annotation<string>(),
  companyValidation: Annotation<CompanyValidation | undefined>(),
  resolvedCompany: Annotation<ResolvedCompany | undefined>(),
  resolvedTicker: Annotation<string | undefined>(),
  resolvedSuffix: Annotation<string | null | undefined>(),
  researchResults: Annotation<ResearchResults | undefined>(),
  marketData: Annotation<MarketData | undefined>(),
  financialData: Annotation<FinancialData | undefined>(),
  report: Annotation<Report | undefined>(),
  trace: Annotation<TraceEntry[]>({
    reducer: (existing: TraceEntry[] = [], update: TraceEntry[] = []) =>
      existing.concat(update),
    default: () => [],
  }),
});
