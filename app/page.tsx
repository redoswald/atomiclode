import { hasDatabase } from "@/db";
import { homeCounts, type HomeCounts } from "@/lib/atoms/stats";

// Counts change with every review; never prerender this page.
export const dynamic = "force-dynamic";

export default async function Home() {
  if (!hasDatabase()) {
    return (
      <Shell>
        <Notice title="No database configured">
          On Vercel: open the project&apos;s Storage tab, create a Neon Postgres database, connect it, and redeploy. The
          build applies migrations and seed data by itself. Locally: set <code className="font-mono">DATABASE_URL</code> in{" "}
          <code className="font-mono">.env.local</code> and run <code className="font-mono">npm run db:prepare</code>.
        </Notice>
      </Shell>
    );
  }

  let counts: HomeCounts;
  try {
    counts = await homeCounts();
  } catch (err) {
    return (
      <Shell>
        <Notice title="Database error">
          {err instanceof Error ? err.message : String(err)}. If the tables are missing, redeploy (the build applies
          migrations) or run <code className="font-mono">npm run db:prepare</code> locally.
        </Notice>
      </Shell>
    );
  }

  if (counts.total === 0) {
    return (
      <Shell>
        <Notice title="Empty database">
          The schema is in place but there are no atoms. Redeploy (the build seeds the database) or run{" "}
          <code className="font-mono">npm run db:prepare</code> locally.
        </Notice>
      </Shell>
    );
  }

  const newTotal = counts.newAvailable.word + counts.newAvailable.chunk + counts.newAvailable.grammar;

  return (
    <Shell>
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium">French · Day {counts.day}</h1>
        <span className="text-sm text-muted">{counts.reviewsTotal} reviews so far</span>
      </header>

      <Section title="Refresh" note={counts.dueNow === 0 ? "nothing due" : undefined}>
        {counts.dueNow} {plural(counts.dueNow, "concept")} ready
      </Section>

      <Section title="Learn">
        {counts.newAvailable.word} new {plural(counts.newAvailable.word, "word")} · {counts.newAvailable.chunk}{" "}
        {plural(counts.newAvailable.chunk, "phrase")} · {counts.newAvailable.grammar} grammar{" "}
        {plural(counts.newAvailable.grammar, "idea")}
        {newTotal === 0 && <span className="text-muted"> — all introduced</span>}
      </Section>

      <Section title="Read" note="milestone 3">
        <span className="text-muted">Import or generate a passage.</span>
      </Section>

      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-6 text-sm sm:grid-cols-4">
        <Stat label="Atoms" value={counts.total} />
        <Stat label="Learning" value={counts.byStatus.learning} />
        <Stat label="Review" value={counts.byStatus.review} />
        <Stat label="New" value={counts.byStatus.new} />
      </dl>
      <p className="mt-3 text-xs text-muted">
        {counts.byType.word} words · {counts.byType.chunk} chunks · {counts.byType.grammar} grammar
        {counts.byStatus.suspended > 0 && ` · ${counts.byStatus.suspended} suspended`}
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-xl flex-1 px-5 py-10 sm:py-16">{children}</main>;
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">{title}</h2>
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
      <p className="mt-1 text-sm">{children}</p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="text-xl tabular-nums">{value}</dd>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-line p-5">
      <h1 className="font-medium">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted">{children}</p>
    </section>
  );
}

function plural(n: number, word: string) {
  return n === 1 ? word : `${word}s`;
}
