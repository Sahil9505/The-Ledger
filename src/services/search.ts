import type { SearchResult } from "../agent/state";
import { withTimeout } from "./timeout";

const SEARCH_TIMEOUT = 4000;

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

async function fetchSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const controller = new AbortController();
  const response = await withTimeout(
    fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "basic",
        max_results: maxResults,
        include_answer: false,
      }),
      signal: controller.signal,
    }),
    SEARCH_TIMEOUT,
    `Tavily search: ${query.slice(0, 40)}`,
    controller
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Tavily search failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as TavilyResponse;
  return (data.results || []).map((result) => ({
    title: result.title,
    url: result.url,
    content: result.content,
  }));
}

export async function webSearch(
  query: string,
  { maxResults = 5 }: { maxResults?: number } = {}
): Promise<SearchResult[]> {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY is required for web search.");
  }

  try {
    return await fetchSearch(query, maxResults);
  } catch (err) {
    console.warn(`Tavily search failed for "${query.slice(0, 50)}":`, (err as Error).message);
    return [];
  }
}
