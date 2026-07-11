import type { ReportDecision } from "@/agent/state";

interface VerdictStampProps {
  decision?: ReportDecision;
  dataQuality?: "strong" | "partial" | "limited";
}

function confidenceColor(confidence: number): string {
  if (confidence >= 70) return "var(--invest)";
  if (confidence >= 40) return "var(--gold)";
  return "var(--pass)";
}

export default function VerdictStamp({ decision, dataQuality }: VerdictStampProps) {
  if (!decision) return null;
  const isInvest = decision.decision === "INVEST";
  // When there's no usable data we deliberately avoid showing a PASS/INVEST
  // verdict, which would mislead — show "NO DATA" instead.
  const noData = decision.confidence === 0 && dataQuality === "limited";

  return (
    <div className={`stamp ${noData || !isInvest ? "stamp--pass" : "stamp--invest"}`}>
      <div className="stamp__ring">
        <span className="stamp__word">{noData ? "NO DATA" : decision.decision}</span>
        <span className="stamp__confidence" style={{ color: confidenceColor(decision.confidence) }}>
          {noData ? "UNAVAILABLE" : `${decision.confidence}% CONF.`}
        </span>
      </div>
    </div>
  );
}
