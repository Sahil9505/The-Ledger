import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState } from "./state";
import { validateCompany } from "./nodes/validateCompany";
import { resolveTickerNode } from "./nodes/resolveTicker";
import { gatherResearch } from "./nodes/gatherResearch";
import { fetchMarketData } from "./nodes/fetchMarketData";
import { fetchFundamentals } from "./nodes/fetchFundamentals";
import { synthesizeReport } from "./nodes/synthesizeReport";

export function buildGraph() {
  const graph = new StateGraph(AgentState)
    .addNode("validateCompany", validateCompany)
    .addNode("resolveTicker", resolveTickerNode)
    .addNode("gatherResearch", gatherResearch)
    .addNode("fetchMarketData", fetchMarketData)
    .addNode("fetchFundamentals", fetchFundamentals)
    .addNode("synthesizeReport", synthesizeReport)
    .addEdge(START, "validateCompany")
    .addEdge("validateCompany", "resolveTicker")
    // Fan out: all three run in parallel after ticker is resolved
    .addEdge("resolveTicker", "gatherResearch")
    .addEdge("resolveTicker", "fetchMarketData")
    .addEdge("resolveTicker", "fetchFundamentals")
    // synthesizeReport waits for all three to finish (AND semantics)
    .addEdge("gatherResearch", "synthesizeReport")
    .addEdge("fetchMarketData", "synthesizeReport")
    .addEdge("fetchFundamentals", "synthesizeReport")
    .addEdge("synthesizeReport", END);

  return graph.compile();
}

// Compile the graph once and reuse it. Compiling per-request is wasteful
// and the compiled graph is stateless/safe to share across requests.
let compiledGraph: ReturnType<typeof buildGraph> | null = null;
export function getGraph(): ReturnType<typeof buildGraph> {
  if (!compiledGraph) compiledGraph = buildGraph();
  return compiledGraph;
}
