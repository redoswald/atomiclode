import { Shell } from "@/app/components/shell";
import { db, hasDatabase } from "@/db";
import { vocabStats } from "@/lib/atoms/vocab-stats";
import { CoverageChart } from "./chart";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  if (!hasDatabase()) {
    return (
      <Shell title="Stats">
        <p className="text-sm text-muted">No database configured.</p>
      </Shell>
    );
  }
  const s = await vocabStats(db());
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <Shell title="Stats" eyebrow="Progress you can read.">
      <section className="card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Vocabulary</h2>
          <span className="text-sm text-muted">{s.total} known</span>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <Stat label="Strong" value={s.strong} hint="21+ days" />
          <Stat label="Developing" value={s.developing} />
          <Stat label="Fragile" value={s.fragile} hint="lapsed or looked up often" />
        </dl>
        <p className="mt-4 text-xs text-muted">
          {s.words} words · {s.chunks} phrases · {s.grammar} grammar ideas
        </p>
      </section>

      <section className="card mt-4 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Coverage</h2>
          <span className="font-display text-3xl tabular-nums">{pct(s.corpusCoverage)}</span>
        </div>
        <p className="mt-1 text-xs text-muted">Estimated share of everyday French text made of words you know, from the frequency list.</p>
        <CoverageChart series={s.series} />
      </section>

      <section className="card mt-4 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Reading</h2>
          <span className="text-sm text-muted">
            {s.passagesRead} of {s.passagesTotal} passages read
          </span>
        </div>
      </section>
    </Shell>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="font-display text-3xl tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}
