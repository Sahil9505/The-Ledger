"use client";

import type { TraceEntry } from "@/agent/state";

interface TraceLogProps {
  trace?: TraceEntry[];
  isLoading: boolean;
}

export default function TraceLog({ trace = [], isLoading }: TraceLogProps) {
  if (!trace?.length && !isLoading) return null;

  return (
    <div className="trace">
      <div className="trace__label">RESEARCH LOG</div>
      <ul className="trace__list">
        {trace.map((t, i) => (
          <li key={i} className="trace__item">
            <span className="trace__step">{String(i + 1).padStart(2, "0")}</span>
            <span className="trace__name">{t.step}</span>
            <span className="trace__detail">{t.detail}</span>
          </li>
        ))}
        {isLoading && (
          <li className="trace__item trace__item--pending">
            <span className="trace__step">…</span>
            <span className="trace__name">working</span>
          </li>
        )}
      </ul>
    </div>
  );
}
