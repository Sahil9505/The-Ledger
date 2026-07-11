"use client";

import { useState } from "react";
import type { ResolvedCompany, Report, MarketData, SearchResult, FinancialData, KeyMetrics } from "@/agent/state";
import VerdictStamp from "./VerdictStamp";
import PriceChart from "./PriceChart";

interface SectionProps {
  label: string;
  children: React.ReactNode;
}

function Section({ label, children }: SectionProps) {
  return (
    <section className="section">
      <div className="section__label">{label}</div>
      {children}
    </section>
  );
}

function BulletList({ items, emptyLabel = "None noted." }: { items?: string[]; emptyLabel?: string }) {
  if (!items?.length) return <p className="muted">{emptyLabel}</p>;

  return (
    <ul className="bullets">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function formatCompact(n: number | null, currency = "USD"): string {
  if (n == null) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toLocaleString("en-US")}`;
  }
}

const METRIC_META: Record<string, string> = {
  "Market Cap": "as of latest close",
  "P/E Ratio": "trailing twelve months",
  "Revenue (TTM)": "trailing twelve months",
  "Rev. Growth (YoY)": "year-over-year change",
  "Net Margin": "net income / revenue",
  "52-Wk High": "last 52 weeks",
  "52-Wk Low": "last 52 weeks",
};

function colorForGrowth(value: number | null): string | undefined {
  if (value == null) return undefined;
  return value > 0 ? "var(--invest)" : value < 0 ? "var(--pass)" : undefined;
}

function KeyMetricCard({
  label,
  value,
  suffix,
  valueColor,
  currency,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  valueColor?: string;
  currency?: string;
}) {
  const isUnavailable = value == null;
  const display = isUnavailable ? (
    <span className="key-metric__na">—</span>
  ) : suffix === "%" ? (
    `${value.toFixed(1)}%`
  ) : (
    formatCompact(value, currency)
  );
  return (
    <div className="key-metric" title={METRIC_META[label] || ""}>
      <div className="key-metric__label">{label}</div>
      <div
        className="key-metric__value"
        style={{ color: isUnavailable ? undefined : valueColor }}
        data-unavailable={isUnavailable ? "" : undefined}
      >
        {display}
      </div>
      <div className="key-metric__sub">{METRIC_META[label] || ""}</div>
    </div>
  );
}

function KeyMetricsGrid({ metrics }: { metrics: KeyMetrics | undefined }) {
  return (
    <div className="key-metrics">
      <KeyMetricCard label="Market Cap" value={metrics?.marketCap ?? null} currency={metrics?.currency} />
      <KeyMetricCard label="P/E Ratio" value={metrics?.peRatio ?? null} currency={metrics?.currency} />
      <KeyMetricCard label="Revenue (TTM)" value={metrics?.revenueTTM ?? null} currency={metrics?.currency} />
      <KeyMetricCard label="Rev. Growth (YoY)" value={metrics?.revenueGrowthYoY ?? null} suffix="%" valueColor={colorForGrowth(metrics?.revenueGrowthYoY ?? null)} />
      <KeyMetricCard label="Net Margin" value={metrics?.netMargin ?? null} suffix="%" valueColor={colorForGrowth(metrics?.netMargin ?? null)} />
      <KeyMetricCard label="52-Wk High" value={metrics?.week52High ?? null} currency={metrics?.currency} />
      <KeyMetricCard label="52-Wk Low" value={metrics?.week52Low ?? null} currency={metrics?.currency} />
    </div>
  );
}

function dedupeByTitle(items: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function CollapsibleSourceList({ items, label }: { items?: SearchResult[]; label: string }) {
  const [open, setOpen] = useState(false);
  const deduped = dedupeByTitle(items || []);
  if (!deduped.length) return null;

  return (
    <div className="sources-wrap">
      <button className="sources-toggle" onClick={() => setOpen(!open)}>
        {label} ({deduped.length}) {open ? "▲" : "▼"}
      </button>
      {open && (
        <ul className="sources">
          {deduped.map((item, i) => (
            <li key={i}>
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ResultData {
  companyName: string;
  resolvedCompany?: ResolvedCompany;
  report?: Report;
  marketData?: MarketData;
  sources?: {
    overview?: SearchResult[];
    news?: SearchResult[];
    financials?: SearchResult[];
  };
}

function ConfidenceMeter({
  confidence,
  quality,
  rationale,
}: {
  confidence: number;
  quality?: "strong" | "partial" | "limited";
  rationale?: string[];
}) {
  const clamped = Math.max(0, Math.min(100, confidence));
  const fillCls = quality ? `conf__fill conf__fill--${quality}` : "conf__fill";
  return (
    <div className="conf">
      <div className="conf__head">
        <span>CONFIDENCE</span>
        <span>{clamped}%</span>
      </div>
      <div className="conf__track">
        <div className={fillCls} style={{ width: `${clamped}%` }} />
      </div>
      {rationale && rationale.length > 0 && (
        <ul className="conf__rationale">
          {rationale.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ReportCard({ result }: { result: ResultData }) {
  const { resolvedCompany, report, marketData, sources } = result;
  const decision = report?.decision;
  const overview = report?.companyOverview;

  return (
    <article className="report">
      <div className="report__header">
        <div>
          <h2 className="report__company">{resolvedCompany?.fullName || result.companyName}</h2>
          <div className="report__meta">
            <span className="mono">{resolvedCompany?.ticker || "UNLISTED"}</span>
            <span> · {resolvedCompany?.sector || "Unknown sector"}</span>
            <span> · {resolvedCompany?.exchange || "N/A"}</span>
            {report?.dataQuality && (
              <span className={`badge badge--${report.dataQuality}`}>
                data: {report.dataQuality}
              </span>
            )}
          </div>
        </div>
        <VerdictStamp decision={decision} dataQuality={report?.dataQuality} />
      </div>

      {report?.executiveSummary && (
        <Section label="EXECUTIVE SUMMARY">
          <p className="report__exec">{report.executiveSummary}</p>
        </Section>
      )}

      <div className="report__grid report__grid--stacked">
        <Section label="COMPANY OVERVIEW">
          <dl className="facts">
            <dt>What it does</dt>
            <dd>{overview?.whatItDoes || "unavailable"}</dd>
            <dt>Founded</dt>
            <dd>{overview?.foundedYear || "unavailable"}</dd>
            <dt>Headquarters</dt>
            <dd>{overview?.headquarters || resolvedCompany?.headquarters || "unavailable"}</dd>
            <dt>Brief history</dt>
            <dd>{overview?.briefHistory || "unavailable"}</dd>
          </dl>
        </Section>

        <Section label="PRICE HISTORY">
          <PriceChart data={marketData} />
        </Section>
      </div>

      <Section label="KEY METRICS">
        <KeyMetricsGrid metrics={report?.keyMetrics} />
      </Section>

      <div className="report__grid">
        <Section label="BULL CASE">
          <BulletList items={report?.bullCase} emptyLabel="No bull case could be supported from the sources." />
        </Section>
        <Section label="BEAR CASE">
          <BulletList items={report?.bearCase} emptyLabel="No bear case could be supported from the sources." />
        </Section>
      </div>

      <Section label="FINAL CALL">
        <ConfidenceMeter
          confidence={decision?.confidence ?? 0}
          quality={report?.dataQuality}
          rationale={report?.confidenceRationale}
        />
        <BulletList items={decision?.reasoning} emptyLabel="No decision reasoning returned." />
      </Section>

      <div className="report__grid">
        <CollapsibleSourceList items={sources?.overview} label="SOURCES: COMPANY" />
        <CollapsibleSourceList items={[...(sources?.news || []), ...(sources?.financials || [])]} label="SOURCES: NEWS + FINANCIALS" />
      </div>

      <p className="disclaimer">
        This is an AI-generated research opinion for demonstration purposes, not financial advice.
      </p>
    </article>
  );
}
