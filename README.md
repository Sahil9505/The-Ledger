# The Ledger — Investment Agent

A Next.js app that researches a company and produces an investment verdict.
You enter a company name, and the agent resolves a ticker, gathers market and
fundamental data (Yahoo Finance / NSE India), runs web research (Tavily), and
synthesizes a report with an LLM (Google Gemini, with an OpenRouter fallback).

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **LangGraph** (`@langchain/langgraph`) agent graph orchestrating research nodes
- **Yahoo Finance 2** / **stock-nse-india** for market & fundamental data
- **Google Gemini** via `@langchain/google-genai` (OpenRouter fallback via `@langchain/openai`)

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your keys
npm run dev                  # http://localhost:3000
```

Build / start:

```bash
npm run build
npm run start
```

## Environment variables

Copy `.env.example` to `.env.local` and set the values. **Never commit
`.env.local`** — it holds real API keys and is gitignored.

| Variable             | Required | Purpose                                  |
| -------------------- | -------- | ---------------------------------------- |
| `GOOGLE_API_KEY`     | Yes*     | Gemini LLM (primary)                     |
| `TAVILY_API_KEY`     | Yes      | Web search for research                  |
| `OPENROUTER_API_KEY` | No       | LLM fallback if Gemini fails             |
| `GEMINI_MODEL`       | No       | Model override (default: `gemini-3-flash-preview`) |
| `FMP_API_KEY`        | No       | Financial Modeling Prep fallback         |
| `PORT`               | No       | Server port (default 3000)               |

\* At least one LLM provider key is required.

## How it works

The agent is a LangGraph state machine in `src/agent/`:

1. `resolveTicker` — turn the company name into a ticker
2. `validateCompany` — confirm the entity is a real, analyzable company
3. `fetchMarketData` — price / chart data (Yahoo Finance, NSE India)
4. `fetchFundamentals` — financials
5. `gatherResearch` — web research via Tavily
6. `synthesizeReport` — LLM assembles the verdict

API routes:

- `POST /api/analyze` — run the agent for a company
- `GET /api/health` — health check

UI lives in `src/app` (`page.tsx`, `layout.tsx`) with components in
`src/components` (input, chart, trace log, verdict stamp, report card).

## Notes

- `.next/`, `.cache/`, and `node_modules/` are build/runtime output and are
  gitignored — they regenerate automatically.
- `npm run lint` uses `next lint`.
