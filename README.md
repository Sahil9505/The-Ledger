# The Ledger — AI Investment Research Agent

> An LLM-orchestrated agent that takes a company name and returns a structured
> **INVEST / PASS** verdict with verified fundamentals, a 1-year price chart, a
> bull/bear case, a confidence score, and the web sources it used. Built with
> **Next.js 16 + LangGraph**.

This README is the full assignment write-up.

- [1. Overview](#1-overview--what-it-does)
- [2. How to run it](#2-how-to-run-it--setup--run-steps)
- [3. How it works](#3-how-it-works--approach--architecture)
- [4. Key decisions & trade-offs](#4-key-decisions--trade-offs)
- [5. Example runs](#5-example-runs--agent-output-on-real-companies)
- [6. What I'd improve with more time](#6-what-i-would-improve-with-more-time)

---

## 1. Overview — What it does

**The Ledger** researches a company and produces an investment verdict. You
type a name (e.g. *Apple*, *Reliance Industries*, *Tesla*) and it returns a
structured call backed by evidence: a 1-year price chart, verified
fundamentals, a bull/bear case, a confidence score, and the web sources it
consulted.

The key design principle: **the numbers come from verified data providers, not
from the LLM's memory.** The LLM is used for *synthesis and prose*; hard figures
(market cap, revenue, margins, P/E, price trend) are pulled from Yahoo Finance /
NSE India and passed to the model as a "verified data block" with an explicit
instruction not to invent numbers. If the LLM is unavailable (very common on
free tiers), the system transparently falls back to a **rules-based, fully
data-driven** report so the user still gets a defensible verdict.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · LangGraph
(`@langchain/langgraph`) · Yahoo Finance 2 · stock-nse-india · Tavily (web) ·
Google Gemini (`@langchain/google-genai`, primary) · OpenRouter
(`@langchain/openai`, fallback).

---

## 2. How to run it — Setup & run steps

**Prerequisites:** Node.js ≥ 18.18, npm.

```bash
npm install
cp .env.example .env.local   # fill in your keys (never commit .env.local)
npm run dev                  # http://localhost:3000
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_API_KEY` | Yes* | Gemini LLM (primary) |
| `TAVILY_API_KEY` | Yes | Web search for research |
| `OPENROUTER_API_KEY` | No | LLM fallback if Gemini fails |
| `GEMINI_MODEL` | No | Model override (default `gemini-3-flash-preview`) |
| `FMP_API_KEY` | No | Financial Modeling Prep fallback |
| `PORT` | No | Server port (default 3000) |

\* At least one LLM key is required. Build/start: `npm run build && npm run start`.
Health: `GET /api/health`. Direct API call:

```bash
curl -N -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" -d '{"companyName":"Apple"}'
```

Returns Server-Sent Events (`trace` per step, then `result`, or `error`).

---

## 3. How it works — Approach & architecture

A **LangGraph state machine** (`src/agent/graph.ts`) drives a 6-step pipeline.
The graph is compiled **once** and reused across requests (stateless/safe to
share). State lives in an `Annotation.Root` (`src/agent/state.ts`); the `trace`
field uses a reducer so every node appends its own log line.

```
START → validateCompany → resolveTicker
                        resolveTicker ─┬─► gatherResearch     (parallel)
                                        ├─► fetchMarketData
                                        └─► fetchFundamentals
                            └─► synthesizeReport (joins all 3) ─► END
```

- **validateCompany** — LLM decides if the input is a real company; on LLM
  failure falls back to a Yahoo `search` (EQUITY/ETF only, so crypto/forex/index
  junk is rejected). Throws `422` if not recognized.
- **resolveTicker** — exchange-aware suffix handling (`.NS`, `.BO`, `.L`, …),
  probing Yahoo `chart` to confirm the symbol resolves.
- **fetchMarketData / fetchFundamentals** — Yahoo primary, NSE (Indian
  exchanges) / FMP fallback; 12s timeouts; `Promise.allSettled` takes the first
  non-null winner. Degrade to `unavailable`/`null` rather than throwing.
- **gatherResearch** — three parallel Tavily searches (profile / news /
  financials); failed queries degrade to `[]`.
- **synthesizeReport** — builds a verified-data block, asks the LLM for JSON,
  then **overwrites confidence + data-quality with data-derived values**.
  Falls back to a rules-based builder if the LLM is down or returned junk; if
  *no* numbers exist at all, returns an honest "insufficient data" report.

**LLM service** (`src/services/llm.ts`): Gemini→OpenRouter fallback, transient
error detection (`429`/quota/timeout), a 5-min down-cooldown to skip slow
round-trips, strict JSON parsing. **Confidence & data-quality are never from the
LLM** — they're computed deterministically from which verified points returned.

**Streaming:** `POST /api/analyze` returns SSE with a 30s global deadline
(`maxDuration = 60` for Vercel) and a 15-min result cache (in-memory `Map` +
JSON on disk).

---

## 4. Key decisions & trade-offs

- **Verified data over LLM memory** — figures come from providers, not model
  recall; trade-off: only as good as free-provider coverage.
- **LLM for prose, rules for fallback** — confidence is data-derived and the
  app works on free tiers; trade-off: rules verdict is less nuanced than LLM.
- **Parallel fan-out** — 3× throughput; trade-off: each branch must degrade
  independently (handled via `unavailable`/`[]`).
- **Free, key-less data (Yahoo/NSE/Tavily)** — reviewer runs it with zero paid
  subscriptions; trade-off: aggressive rate limits (Yahoo `429` absorbed by
  timeouts/fallbacks).
- **Per-call timeouts + `Promise.allSettled`** — no single provider can hang the
  request; trade-off: may prefer a fast provider over a slow-but-valid one.
- **SSE over WebSocket** — native, no socket lib; trade-off: one-directional.
- **Single-pass agent (no critic)** — cheaper/faster; trade-off: no second
  opinion catches a wrong call.
- **In-memory + disk cache** — zero infra; trade-off: not shared across
  instances (needs Redis in prod).

Left out: auth/multi-user, paid data tiers beyond FMP, automated tests/CI, RAG
over filings, portfolio/screener, model calibration.

---

## 5. Example runs — Agent output on real companies

> Captured **live** from a running instance. At capture time **both LLM
> providers were rate-limited**, so every run exercised the **rules-based
> fallback** — the most important behavior to demonstrate: a fully data-grounded
> verdict instead of an error. Numbers are **real** (Yahoo Finance).

| Company | Ticker | Verdict | Conf. | Data quality | Highlights |
| --- | --- | --- | --- | --- | --- |
| Apple | AAPL | **INVEST** | 100 | strong | $4.63T cap, +16.6% rev growth, +51.15% 1Y |
| Tesla | TSLA | **INVEST** | 100 | strong | P/E 370 flagged "rich", +28.67% 1Y |
| Reliance Ind. | RELIANCE.NS | **INVEST** | 100 | strong | INR, P/E 21.9, **−11.86% 1Y** reflected in bear case |

**Apple — bull:** revenue $451.44B (+16.6% YoY), 24.8% net margin, $4.63T cap,
+51.1% price. **Bear:** 38.2× earnings, elevated leverage (D/E 79.55).
**Trace:** `Validate → Resolve → Fetch Fundamentals → Fetch Price → Gather
Research → Synthesize (INVEST, 100, strong)`.

---

## 6. What I'd improve with more time

1. **Automated tests + CI** (unit + mocked graph integration + GitHub Actions).
2. **Distributed cache (Redis/KV)** instead of in-memory + local file.
3. **Per-provider circuit breakers + backoff w/ jitter** replacing the blunt
   5-min cooldown.
4. **RAG over 10-K/10-Q filings** for source-grounded bull/bear.
5. **Adversarial critic agent** (second LangGraph pass).
6. **Homonym disambiguation** (Delta, Target, …).
7. **Confidence calibration** from labeled outcomes.
8. Run history / watchlists / screener; per-claim source attribution;
   structured tool-calling output; paid data tier; i18n/multi-currency UX.

---

## Project layout

```
src/
  agent/            # LangGraph pipeline
    graph.ts        # node wiring + compile-once
    state.ts        # AgentState annotation + types
    nodes/          # validateCompany, resolveTicker, gatherResearch,
                    # fetchMarketData, fetchFundamentals, synthesizeReport
  app/              # Next.js App Router
    api/analyze     # SSE streaming route (30s budget, 15-min cache)
    api/health      # provider health check
    page.tsx        # SSE client UI
  components/       # Masthead, CompanyInput, TraceLog, ReportCard,
                    # PriceChart, VerdictStamp
  services/         # llm, market, fundamentals, ticker, search,
                    # stockNseIndia, yahooClient, cache, timeout
```

## Notes

- `.next/`, `node_modules/`, `.cache/`, and `.env.local` are gitignored — they
  regenerate and must never be committed.
- The repo's auto-generated zip (used for submission) excludes those paths.

