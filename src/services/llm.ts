import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessage } from "@langchain/core/messages";
import { withTimeout } from "./timeout";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

let _useGemini = true;
let _llm: ChatGoogleGenerativeAI | ChatOpenAI | null = null;

function createGeminiLLM(temperature?: number): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_API_KEY,
    model: GEMINI_MODEL,
    temperature: temperature ?? 0.2,
    maxRetries: 0,
  });
}

function createOpenRouterLLM(temperature?: number): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: OPENROUTER_MODEL,
    temperature: temperature ?? 0.2,
    maxRetries: 0,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
        "X-Title": process.env.OPENROUTER_APP_NAME || "Ledger Investment Agent",
      },
    },
  });
}

let _currentTemperature: number | undefined = undefined;

// When every configured LLM provider fails (typically rate-limited on the
// free tier), remember it for a short window so subsequent requests in the
// same process skip the slow provider round-trips (~8s Gemini + ~2.5s
// OpenRouter each) and fall back immediately. The window auto-expires and is
// also cleared on any successful call, so we resume using the LLM the moment
// quota resets.
const LLM_DOWN_COOLDOWN_MS = 5 * 60 * 1000;
let _llmDownUntil: number | null = null;

function getLLM(): ChatGoogleGenerativeAI | ChatOpenAI {
  if (_llm) return _llm;

  if (_useGemini && process.env.GOOGLE_API_KEY) {
    _llm = createGeminiLLM(_currentTemperature);
  } else if (process.env.OPENROUTER_API_KEY) {
    _llm = createOpenRouterLLM(_currentTemperature);
  } else {
    throw new Error("No LLM provider configured. Set GOOGLE_API_KEY or OPENROUTER_API_KEY.");
  }

  return _llm;
}

function normalizeContent(content: string | BaseMessage[] | unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: string }).text === "string")
          return (part as { text: string }).text;
        return "";
      })
      .join("");
  }
  return String(content ?? "");
}

function isTransientRateLimitError(err: unknown): boolean {
  const message = String((err as Error)?.message || err || "").toLowerCase();
  return /429|rate limit|too many requests|quota|insufficient credits|temporarily unavailable|timeout|timed out|fetch failed|gateway timeout|service unavailable/.test(
    message
  );
}

interface LLMOptions {
  maxAttempts?: number;
  temperature?: number;
  timeoutMs?: number;
}

function buildMessages(systemPrompt: string, userPrompt: string): { role: string; content: string }[] {
  return [
    {
      role: "system",
      content: `${systemPrompt}\nRespond with ONLY valid JSON. No markdown, no commentary.`,
    },
    { role: "user", content: userPrompt },
  ];
}

function parseJSON(raw: unknown): Record<string, unknown> {
  const text = normalizeContent(raw);
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : cleaned;
  return JSON.parse(jsonText) as Record<string, unknown>;
}

export async function askForJSON(
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions = {}
): Promise<Record<string, unknown>> {
  const messages = buildMessages(systemPrompt, userPrompt);
  // Free-tier note: keep attempts low so we don't burn the daily quota
  // on retries. maxRetries is already 0 in the clients.
  const { maxAttempts = 1, temperature, timeoutMs } = options;

  // Fast-path: if every LLM provider was recently unavailable (e.g. free-tier
  // rate limit), skip the slow round-trips and let the caller fall back now.
  if (_llmDownUntil !== null && Date.now() < _llmDownUntil) {
    throw new Error("LLM provider temporarily unavailable (recently rate-limited); using fallback.");
  }

  const providers = [
    {
      name: "Gemini",
      key: "GOOGLE_API_KEY",
      llm: () => {
        _currentTemperature = temperature;
        _llm = null;
        _llm = getLLM();
        return _llm!;
      },
    },
    {
      name: "OpenRouter",
      key: "OPENROUTER_API_KEY",
      llm: () => {
        _useGemini = false;
        _currentTemperature = temperature;
        _llm = null;
        _llm = getLLM();
        return _llm!;
      },
    },
  ];

  let lastError: unknown = null;

  try {
    for (const provider of providers) {
      if (!process.env[provider.key]) continue;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const llm = provider.llm();
          const invokePromise = llm.invoke(messages);
          const res = timeoutMs
            ? await withTimeout(invokePromise, timeoutMs, `${provider.name} LLM`)
            : await invokePromise;
          _llmDownUntil = null; // a provider responded — clear the outage marker
          return parseJSON(res?.content);
        } catch (err) {
          lastError = err;
          const isQuota = isTransientRateLimitError(err);

          if (attempt === maxAttempts || !isQuota) {
            break;
          }
        }
      }
    }
  } catch (err) {
    lastError = err;
  }

  // All providers failed — remember it so subsequent calls in this process
  // short-circuit to the fallback instead of re-attempting for ~5 minutes.
  _llmDownUntil = Date.now() + LLM_DOWN_COOLDOWN_MS;
  throw new Error(`LLM request failed: ${(lastError as Error)?.message || lastError}`);
}
