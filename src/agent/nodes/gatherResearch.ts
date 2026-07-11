import { webSearch } from "../../services/search";
import { now, logNodeDuration } from "../../services/timeout";
import type { AgentStateType, ResearchResults, TraceEntry } from "../state";

export async function gatherResearch(
  state: AgentStateType
): Promise<{
  researchResults: ResearchResults;
  trace: TraceEntry[];
}> {
  const start = now();
  const name = state.resolvedCompany?.fullName || state.companyName;

  const [overviewResults, newsResults, financialResults] = await Promise.all([
    webSearch(`${name} official website founded headquarters history about company`, { maxResults: 5 }),
    webSearch(`${name} latest news developments`, { maxResults: 5 }),
    webSearch(`${name} revenue growth profit margin valuation stock performance earnings`, { maxResults: 5 }),
  ]);

  logNodeDuration("gatherResearch", start);

  return {
    researchResults: {
      overviewResults,
      newsResults,
      financialResults,
    },
    trace: [
      {
        step: "Gather Research",
        detail: `Fetched company profile, news, and financial sources for ${name}.`,
      },
    ],
  };
}
