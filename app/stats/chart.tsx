"use client";

import { useId, useState } from "react";

interface Point {
  date: string;
  coverage: number;
  known: number;
}

/**
 * Coverage over time: a single-series line (no legend needed), 2px stroke,
 * recessive grid, crosshair + tooltip on hover/touch, and a table view.
 */
export function CoverageChart({ series }: { series: Point[] }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const W = 560;
  const H = 200;
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  const pts = series.length === 1 ? [{ ...series[0], date: series[0].date }, series[0]] : series;
  const xs = pts.map((p) => new Date(p.date).getTime());
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 86_400_000);
  const yMax = Math.max(0.1, Math.ceil(Math.max(...pts.map((p) => p.coverage)) * 10) / 10);
  const X = (t: number) => pad.l + ((t - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${X(xs[i]).toFixed(1)},${Y(p.coverage).toFixed(1)}`).join(" ");
  const ticks = [0, yMax / 2, yMax];

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(X(xs[i]) - px) < Math.abs(X(xs[best]) - px)) best = i;
    setHover(best);
  }

  const h = hover !== null ? pts[hover] : null;
  const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  if (series.length === 0 || (series.length === 1 && series[0].known === 0)) {
    return <p className="mt-4 text-sm text-muted">The line starts with your first review.</p>;
  }

  return (
    <div className="mt-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-labelledby={`${id}-title`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title id={`${id}-title`}>Estimated coverage over time</title>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.l - 6} y={Y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
        <text x={pad.l} y={H - 8} fontSize={11} fill="var(--muted)">
          {fmt(pts[0].date)}
        </text>
        <text x={W - pad.r} y={H - 8} fontSize={11} fill="var(--muted)" textAnchor="end">
          {fmt(pts[pts.length - 1].date)}
        </text>
        <path d={path} fill="none" stroke="var(--chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {h && hover !== null && (
          <g>
            <line x1={X(xs[hover])} x2={X(xs[hover])} y1={pad.t} y2={H - pad.b} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={X(xs[hover])} cy={Y(h.coverage)} r={5} fill="var(--chart)" stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </svg>
      <div className="mt-1 flex min-h-5 items-baseline justify-between text-xs text-muted">
        <span>{h ? `${fmt(h.date)} · ${Math.round(h.coverage * 100)}% · ${h.known} words` : "Hover or touch the line for details."}</span>
        <button onClick={() => setTable((t) => !t)} className="underline">
          {table ? "Hide table" : "Table"}
        </button>
      </div>
      {table && (
        <div className="mt-2 max-h-48 overflow-auto text-xs">
          <table className="w-full">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 font-normal">Date</th>
                <th className="py-1 font-normal">Coverage</th>
                <th className="py-1 font-normal">Words</th>
              </tr>
            </thead>
            <tbody>
              {series.map((p) => (
                <tr key={p.date} className="border-t border-line">
                  <td className="py-1">{p.date}</td>
                  <td className="py-1 tabular-nums">{Math.round(p.coverage * 100)}%</td>
                  <td className="py-1 tabular-nums">{p.known}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
