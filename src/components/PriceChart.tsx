"use client";

import { useState, useRef, useCallback } from "react";
import type { MarketData, MarketDataUnavailable, ChartPoint } from "@/agent/state";

function formatCurrency(value: number, currency = "USD"): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompactPrice(value: number): string {
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return value.toFixed(2);
}

const W = 640;
const H = 220;
const PAD = 28;
const IW = W - PAD * 2;
const IH = H - PAD * 2;

interface Point {
  x: number;
  y: number;
  close: number;
  date: string;
}

function layoutPoints(points: ChartPoint[]): { pts: Point[]; min: number; max: number; range: number } {
  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const pts = points.map((p, i) => ({
    x: PAD + (IW * i) / Math.max(points.length - 1, 1),
    y: PAD + IH - ((p.close - min) / range) * IH,
    close: p.close,
    date: p.date,
  }));
  return { pts, min, max, range };
}

function closestPoint(mouseX: number, pts: Point[]): Point | null {
  if (!pts.length) return null;
  let best = pts[0];
  let bestDist = Infinity;
  for (const p of pts) {
    const d = Math.abs(p.x - mouseX);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

interface PriceChartProps {
  data?: MarketData;
}

export default function PriceChart({ data }: PriceChartProps) {
  const [hoverPt, setHoverPt] = useState<Point | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>, pts: Point[]) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = W / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;
    setHoverPt(closestPoint(mouseX, pts));
  }, []);

  const handleMouseLeave = useCallback(() => setHoverPt(null), []);

  if (!data || data.status !== "available") {
    const reason = (data as MarketDataUnavailable | undefined)?.reason || "No market data.";
    const tickerMatch = reason?.match(/for\s+([A-Z0-9.]+)/i);
    const attemptedTicker = tickerMatch?.[1] || null;
    return (
      <div>
        <p className="muted">Price chart unavailable: {reason}</p>
        {attemptedTicker && (
          <p className="muted" style={{ fontSize: "11px", marginTop: "4px" }}>
            Ticker(s) attempted: {attemptedTicker}
          </p>
        )}
      </div>
    );
  }

  const { pts, min, max } = layoutPoints(data.points || []);
  const trendUp = data.percentChange > 0;
  const trendClass = trendUp ? "price-chart__value--up" : data.percentChange < 0 ? "price-chart__value--down" : "price-chart__value--flat";

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${pts[pts.length - 1].x},${PAD + IH} L ${pts[0].x},${PAD + IH} Z`;

  const gridLines = [
    { label: formatCompactPrice(max), y: pts[0] ? pts.filter(p => p.close === max)[0]?.y ?? PAD : PAD },
    { label: formatCompactPrice(min + (max - min) * 0.75), y: PAD + IH * 0.25 },
    { label: formatCompactPrice(min + (max - min) * 0.5), y: PAD + IH * 0.5 },
    { label: formatCompactPrice(min + (max - min) * 0.25), y: PAD + IH * 0.75 },
    { label: formatCompactPrice(min), y: pts[0] ? pts.filter(p => p.close === min)[0]?.y ?? PAD + IH : PAD + IH },
  ];

  const midIdx = Math.floor(pts.length / 2);
  const xLabels = [
    { label: pts[0]?.date || "", x: pts[0]?.x ?? PAD },
    { label: pts[midIdx]?.date || "", x: pts[midIdx]?.x ?? PAD + IW / 2 },
    { label: pts[pts.length - 1]?.date || "", x: pts[pts.length - 1]?.x ?? PAD + IW },
  ];

  const fillColor = trendUp ? "var(--invest)" : "var(--pass)";

  const highPt = pts.reduce((a, b) => (a.close > b.close ? a : b), pts[0]);
  const lowPt = pts.reduce((a, b) => (a.close < b.close ? a : b), pts[0]);

  return (
    <div className="price-chart">
      <div className="price-chart__summary">
        <div>
          <div className="price-chart__label">1-YEAR CHANGE</div>
          <div className={`price-chart__value ${trendClass}`}>
            {typeof data.percentChange === "number"
              ? `${data.percentChange > 0 ? "+" : ""}${data.percentChange.toFixed(2)}%`
              : "unavailable"}
          </div>
        </div>
        <div>
          <div className="price-chart__label">HIGH / LOW</div>
          <div className="price-chart__meta">
            {formatCurrency(data.high, data.currency)} / {formatCurrency(data.low, data.currency)}
          </div>
        </div>
        <div>
          <div className="price-chart__label">LAST CLOSE</div>
          <div className="price-chart__meta">{formatCurrency(data.endClose, data.currency)}</div>
        </div>
      </div>

      <svg
        ref={svgRef}
        className="price-chart__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="One year stock price chart"
        onMouseMove={(e) => handleMouseMove(e, pts)}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: "crosshair" }}
      >
        <defs>
          <linearGradient id="chartAreaFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={fillColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={fillColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        <g className="price-chart__gridlines">
          {gridLines.map((gl, i) => (
            <g key={i}>
              <line
                x1={PAD} y1={gl.y} x2={PAD + IW} y2={gl.y}
                stroke="var(--rule)" strokeWidth="1" strokeDasharray="3,3"
              />
              <text x={PAD + IW + 4} y={gl.y + 3} fill="var(--ink-soft)" fontSize="9" fontFamily="var(--font-mono)">
                {gl.label}
              </text>
            </g>
          ))}
        </g>

        <path d={areaPath} fill="url(#chartAreaFill)" />
        <path d={linePath} fill="none" stroke={fillColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        <circle cx={highPt.x} cy={highPt.y} r="4" fill={fillColor} stroke="var(--paper-raised)" strokeWidth="1.5" />
        <text x={highPt.x + 6} y={highPt.y - 2} fill="var(--ink-soft)" fontSize="9" fontFamily="var(--font-mono)">
          H {formatCompactPrice(highPt.close)}
        </text>

        <circle cx={lowPt.x} cy={lowPt.y} r="4" fill={fillColor} stroke="var(--paper-raised)" strokeWidth="1.5" />
        <text x={lowPt.x + 6} y={lowPt.y + 12} fill="var(--ink-soft)" fontSize="9" fontFamily="var(--font-mono)">
          L {formatCompactPrice(lowPt.close)}
        </text>

        <g className="price-chart__xlabels" fill="var(--ink-soft)" fontSize="9" fontFamily="var(--font-mono)">
          {xLabels.map((xl, i) => (
            <text key={i} x={xl.x} y={H - 4} textAnchor="middle">{xl.label}</text>
          ))}
        </g>

        {hoverPt && (
          <g>
            <line
              x1={hoverPt.x} y1={PAD} x2={hoverPt.x} y2={PAD + IH}
              stroke="var(--ink)" strokeWidth="1" strokeDasharray="2,2" opacity="0.4"
            />
            <rect
              x={Math.min(Math.max(hoverPt.x - 44, PAD), PAD + IW - 88)}
              y={PAD - 26}
              width="88" height="20" rx="3"
              fill="var(--ink)" opacity="0.85"
            />
            <text
              x={Math.min(Math.max(hoverPt.x, PAD + 44), PAD + IW - 44)}
              y={PAD - 13}
              fill="var(--paper-raised)" fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle"
            >
              {hoverPt.date} · {formatCompactPrice(hoverPt.close)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
