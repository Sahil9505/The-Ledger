"use client";

import type { AnalyzeResponse } from "@/agent/state";

export interface HistoryEntry {
  id: number;
  query: string;
  data: AnalyzeResponse;
}

interface HistoryPanelProps {
  entries: HistoryEntry[];
  activeId: number | null;
  onSelect: (entry: HistoryEntry) => void;
}

function VERDICT_LABEL(decision: "INVEST" | "PASS"): string {
  return decision === "INVEST" ? "INVEST" : "PASS";
}

export default function HistoryPanel({ entries, activeId, onSelect }: HistoryPanelProps) {
  if (!entries.length) return null;

  return (
    <section className="history" aria-label="Session history">
      <div className="history__label">
        FILED THIS SESSION · {entries.length} {entries.length === 1 ? "ENTRY" : "ENTRIES"}
      </div>
      <ul className="history__list">
        {entries.map((entry) => {
          const company = entry.data.resolvedCompany;
          const decision = entry.data.report?.decision;
          const verdict = decision?.decision ?? "PASS";
          const isActive = entry.id === activeId;

          return (
            <li key={entry.id}>
              <button
                type="button"
                className={`history__item${isActive ? " history__item--active" : ""}`}
                onClick={() => onSelect(entry)}
              >
                <span
                  className={`history__verdict history__verdict--${verdict.toLowerCase()}`}
                  aria-hidden="true"
                >
                  {VERDICT_LABEL(verdict)}
                </span>
                <span className="history__company">{company?.fullName || entry.data.companyName}</span>
                <span className="history__ticker mono">
                  {company?.ticker || "UNLISTED"}
                </span>
                <span className="history__conf mono">
                  {decision ? `${decision.confidence}%` : "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
