import Link from "next/link";
import { db, hasDatabase } from "@/db";
import { homeCounts, type HomeCounts } from "@/lib/atoms/stats";
import { authEnabled } from "@/lib/auth";
import { hasAnthropicKey } from "@/lib/llm/client";
import { listPassages } from "@/lib/reader/passages";
import { BUDGETS, DEFAULT_NEW_PER_DAY } from "@/lib/review/session";
import { MODALITY_SECONDS } from "@/lib/scheduler";
import { Shell } from "./components/shell";
import { ExploreBox } from "./explore-box";
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
  let latest: Awaited<ReturnType<typeof listPassages>>[number] | undefined;
  try {
    [counts, [latest]] = await Promise.all([homeCounts(new Date(), db()), listPassages(db())]);
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
  const hasKey = hasAnthropicKey();

  return (
    <Shell
      aside={
        <p className="flex items-baseline justify-between text-sm">
          <span>
            French · Day {counts.day} <span className="text-muted">· {counts.reviewsTotal} reviews so far</span>
          </span>
        </p>
      }
    >
      {!authEnabled() && (
        <p className="mb-5 rounded-xl border border-tint-sand bg-tint-sand/50 px-3 py-2 text-xs">
          Open to anyone with the URL. Set <code className="font-mono">APP_SECRET</code> in Vercel and redeploy to require a
          sign-in.
        </p>
      )}

      <section className="card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-3xl">Today</h2>
          <span className="text-sm text-muted">{BUDGETS[recommended]} min recommended</span>
        </div>
        <div className="mt-3 flex gap-2">
          {(["light", "steady", "push"] as const).map((i) => (
            <Link
              key={i}
              href={`/review?intensity=${i}`}
              className={`rounded-full px-3 py-1 text-xs ${i === recommended ? "bg-sage text-sage-ink" : "border border-line text-muted"}`}
            >
              {i}
            </Link>
          ))}
        </div>

        <Row href="/review?intensity=steady" title="Refresh" note={counts.dueNow === 0 ? "nothing due" : `~${Math.max(1, refreshMin)} min`}>
          {counts.dueNow} {plural(counts.dueNow, "concept")} ready
        </Row>
        <Row href="/review?intensity=steady" title="Learn" note={newTotal === 0 ? "all introduced" : `~${Math.max(1, learnMin)} min`}>
          {glossedNew} new {plural(glossedNew, "word")} · {counts.newAvailable.chunk} {plural(counts.newAvailable.chunk, "phrase")} ·{" "}
          {counts.newAvailable.grammar} grammar {plural(counts.newAvailable.grammar, "idea")}
        </Row>
        <Row href={latest ? `/read/${latest.id}` : "/read"} title="Read" note={latest ? `${Math.round(latest.coverage * 100)}% known` : undefined}>
          {latest ? latest.title ?? "Untitled" : <span className="text-muted">Paste a text or an article URL.</span>}
        </Row>
      </section>

      <GlossFiller remaining={counts.unglossed} hasKey={hasKey} />

      <ExploreBox enabled={hasKey} />

      <dl className="mt-8 grid grid-cols-4 gap-3 text-sm">
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

function Row({ href, title, note, children }: { href: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mt-4 flex items-baseline justify-between gap-4 border-t border-line pt-4">
      <span>
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-sm">{children}</span>
      </span>
      <span className="shrink-0 text-xs text-muted">{note ?? "→"}</span>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="font-display text-2xl tabular-nums">{value}</dd>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h1 className="font-display text-2xl">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted">{children}</p>
    </section>
  );
}

function plural(n: number, word: string) {
  return n === 1 ? word : `${word}s`;
}
