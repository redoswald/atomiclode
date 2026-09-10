import Link from "next/link";
import { db, hasDatabase } from "@/db";
import { homeCounts, type HomeCounts } from "@/lib/atoms/stats";
import { authEnabled } from "@/lib/auth";
import { hasAnthropicKey } from "@/lib/llm/client";
import { BUDGETS, DEFAULT_NEW_PER_DAY } from "@/lib/review/session";
import { MODALITY_SECONDS } from "@/lib/scheduler";
import { GlossFiller } from "./gloss-filler";

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
    counts = await homeCounts(new Date(), db());
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

  const glossedNew = Math.max(0, counts.newAvailable.word - counts.unglossed);
  const newTotal = glossedNew + counts.newAvailable.chunk + counts.newAvailable.grammar;
  const refreshMin = Math.round((counts.dueNow * MODALITY_SECONDS.recall) / 60);
  const learnMin = Math.round((Math.min(newTotal, DEFAULT_NEW_PER_DAY) * MODALITY_SECONDS.recognize * 2) / 60);
  const recommended = recommend(refreshMin + learnMin);

  return (
    <Shell>
      {!authEnabled() && (
        <p className="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          Open to anyone with the URL. Set <code className="font-mono">APP_SECRET</code> in Vercel and redeploy to require a
          sign-in.
        </p>
      )}

      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium">French · Day {counts.day}</h1>
        <span className="text-sm text-muted">{counts.reviewsTotal} reviews so far</span>
      </header>

      <p className="mt-4 flex items-baseline justify-between text-sm">
        <span>{BUDGETS[recommended]} min recommended</span>
        <span className="flex gap-2">
          {(["light", "steady", "push"] as const).map((i) => (
            <Link
              key={i}
              href={`/review?intensity=${i}`}
              className={`rounded-md border px-2 py-0.5 text-xs ${i === recommended ? "border-foreground" : "border-line text-muted"}`}
            >
              {i}
            </Link>
          ))}
        </span>
      </p>

      <Section title="Refresh" note={counts.dueNow === 0 ? "nothing due" : `~${Math.max(1, refreshMin)} min`} href="/review?intensity=steady">
        {counts.dueNow} {plural(counts.dueNow, "concept")} ready
      </Section>

      <Section title="Learn" note={newTotal === 0 ? "all introduced" : `~${Math.max(1, learnMin)} min`} href="/review?intensity=steady">
        {glossedNew} new {plural(glossedNew, "word")} · {counts.newAvailable.chunk} {plural(counts.newAvailable.chunk, "phrase")} ·{" "}
        {counts.newAvailable.grammar} grammar {plural(counts.newAvailable.grammar, "idea")}
      </Section>

      <Section title="Read" note="milestone 3">
        <span className="text-muted">Import or generate a passage.</span>
      </Section>

      <GlossFiller remaining={counts.unglossed} hasKey={hasAnthropicKey()} />

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

function recommend(minutes: number): "light" | "steady" | "push" {
  if (minutes <= 5) return "light";
  if (minutes <= 14) return "steady";
  return "push";
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-xl flex-1 px-5 py-10 sm:py-16">{children}</main>;
}

function Section({ title, note, href, children }: { title: string; note?: string; href?: string; children: React.ReactNode }) {
  const heading = href ? (
    <Link href={href} className="font-medium underline-offset-4 hover:underline">
      {title} →
    </Link>
  ) : (
    <h2 className="font-medium">{title}</h2>
  );
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        {heading}
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
