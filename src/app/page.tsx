"use client";

import { useState, useRef, useCallback } from "react";
import Masthead from "@/components/Masthead";
import CompanyInput from "@/components/CompanyInput";
import TraceLog from "@/components/TraceLog";
import ReportCard from "@/components/ReportCard";
import HistoryPanel, { type HistoryEntry } from "@/components/HistoryPanel";
import type { TraceEntry, AnalyzeResponse } from "@/agent/state";

function SkeletonBlock({ height }: { height?: string }) {
  return <div className="skeleton" style={{ height: height || "16px" }} />;
}

function SkeletonReport() {
  return (
    <article className="report report--skeleton" aria-hidden="true">
      <div className="report__header">
        <div style={{ flex: 1 }}>
          <SkeletonBlock height="28px" />
          <div style={{ marginTop: "8px" }}>
            <SkeletonBlock height="14px" />
          </div>
        </div>
        <div className="stamp__ring skeleton" style={{ width: "116px", height: "116px", borderRadius: "50%" }} />
      </div>
      <div className="report__grid report__grid--stacked">
        <div>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ marginBottom: "8px" }}>
              <SkeletonBlock height="12px" />
            </div>
          ))}
        </div>
        <div>
          <SkeletonBlock height="180px" />
        </div>
      </div>
      <div className="key-metrics" style={{ marginBottom: "24px" }}>
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="key-metric skeleton" style={{ padding: "12px", minHeight: "60px" }} />
        ))}
      </div>
      <div className="report__grid">
        {[1, 2].map((i) => (
          <div key={i}>
            {[1, 2, 3].map((j) => (
              <div key={j} style={{ marginBottom: "6px" }}>
                <SkeletonBlock height="14px" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </article>
  );
}

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveTrace, setLiveTrace] = useState<TraceEntry[]>([]);
  const traceRef = useRef<TraceEntry[]>([]);
  const [showSkeleton, setShowSkeleton] = useState(false);

  // Session-only history: held in memory, cleared on every refresh.
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const historyIdRef = useRef(0);
  const [activeId, setActiveId] = useState<number | null>(null);

  const handleSelectHistory = useCallback((entry: HistoryEntry) => {
    setResult(entry.data);
    setActiveId(entry.id);
    setError(null);
    setShowSkeleton(false);
  }, []);

  const handleSubmit = useCallback(async (companyName: string) => {
    setIsLoading(true);
    setShowSkeleton(true);
    setError(null);
    setResult(null);
    setLiveTrace([]);
    traceRef.current = [];
    setActiveId(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Response body is not readable.");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          try {
            const msg = JSON.parse(payload) as Record<string, unknown>;

            if (msg.type === "trace") {
              const entry = msg.entry as TraceEntry;
              traceRef.current = [...traceRef.current, entry];
              setLiveTrace([...traceRef.current]);
            } else if (msg.type === "result") {
              const data = msg.data as AnalyzeResponse;
              const id = ++historyIdRef.current;
              setResult(data);
              setActiveId(id);
              setHistory((prev) => [{ id, query: companyName, data }, ...prev]);
              setShowSkeleton(false);
            } else if (msg.type === "error") {
              setError((msg.error as string) || "Agent run failed.");
              setShowSkeleton(false);
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (err) {
      setError((err as Error).message);
      setShowSkeleton(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const displayTrace = result?.trace || liveTrace;

  return (
    <>
      <Masthead />
      <CompanyInput onSubmit={handleSubmit} isLoading={isLoading} />
      <HistoryPanel entries={history} activeId={activeId} onSelect={handleSelectHistory} />
      <TraceLog trace={displayTrace} isLoading={isLoading} />
      {error && (
        <div className="error-note">
          <strong>Filed with an error:</strong> {error}
        </div>
      )}
      {showSkeleton && !result && <SkeletonReport />}
      {result && <ReportCard result={result} />}
    </>
  );
}
