import Link from "next/link";
import { notFound } from "next/navigation";
import { nextVisit } from "@/app/actions/scenario";
import { Shell } from "@/app/components/shell";
import { Reader } from "@/app/read/[id]/reader";
import { db, hasDatabase } from "@/db";
import { atoms, producePrompts } from "@/db/schema";
import { hasAnthropicKey } from "@/lib/llm/client";
import { openPassage } from "@/lib/reader/passages";
import { scenarioStates, startVisit } from "@/lib/scenarios/visits";
import { eq, inArray } from "drizzle-orm";
import { Rehearsal } from "./rehearsal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ScenarioPage({ params, searchParams }: PageProps<"/scenario/[id]">) {
  const { id } = await params;
  const { visit: visitParam, error } = await searchParams;
  if (!hasDatabase() || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = db();
  const state = (await scenarioStates(d)).find((s) => s.scenario.id === id);
  if (!state) notFound();
  const hasKey = hasAnthropicKey();
  const { scenario, visits } = state;

  const wanted = Number(visitParam);
  const current = visits.find((v) => v.visit.n === wanted) ?? state.latest;

  if (!current) {
    return (
      <Shell back={{ href: "/scenario", label: "Scenes" }}>
        <h1 className="font-display text-4xl leading-tight">{scenario.title || "Sans titre"}</h1>
        <p className="mt-2 text-sm text-muted">{scenario.brief}</p>
        <NextVisitForm scenarioId={id} label="Write the first visit" hasKey={hasKey} />
      </Shell>
    );
  }

  // Opening a visit is what starts it: the bundle joins the queue.
  await startVisit(d, current.visit.id);
  const [view, bundle, prompts] = await Promise.all([
    current.visit.passageId ? openPassage(d, current.visit.passageId) : undefined,
    current.visit.bundle.length ? d.select({ id: atoms.id, type: atoms.type, key: atoms.key, gloss: atoms.gloss, status: atoms.status }).from(atoms).where(inArray(atoms.id, current.visit.bundle)) : [],
    d.select().from(producePrompts).where(eq(producePrompts.visitId, current.visit.id)).orderBy(producePrompts.createdAt),
  ]);
  const ordered = current.visit.bundle.flatMap((bid) => bundle.filter((b) => b.id === bid));
  const isLatest = current.visit.n === state.latest?.visit.n;
  const waiting = ordered.filter((b) => b.status === "new").length;

  return (
    <Shell back={{ href: "/scenario", label: "Scenes" }}>
      <p className="eyebrow">
        Visit {current.visit.n}
        {visits.length > 1 && ` of ${visits.length}`}
      </p>
      <h1 className="font-display mt-2 text-4xl leading-tight" lang="fr">
        {scenario.title || "Sans titre"}
      </h1>
      <p className="mt-3 text-sm text-muted">{scenario.brief}</p>
      <p className="mt-2 text-base">{current.visit.brief}</p>
      {typeof error === "string" && <p className="mt-3 text-sm text-bad">{error}</p>}

      {view ? <Reader view={view} canGloss={hasKey} /> : <p className="mt-6 text-sm text-muted">The dialogue for this visit is gone.</p>}

      {current.visit.translation && (
        <details className="mt-6 text-sm">
          <summary className="cursor-pointer text-muted">In English</summary>
          <p className="mt-3 whitespace-pre-line leading-6 text-muted">{current.visit.translation}</p>
        </details>
      )}

      {ordered.length > 0 && (
        <section className="card mt-8 p-5">
          <h2 className="font-display text-2xl">New here</h2>
          <p className="eyebrow mt-1">{waiting === 0 ? "All in your reviews" : `${waiting} waiting · up to ten a day`}</p>
          <ul className="mt-4 space-y-2 text-sm">
            {ordered.map((b) => (
              <li key={b.id} className="flex items-baseline justify-between gap-4">
                <span className={b.type === "grammar" ? "italic" : "font-medium"} lang={b.type === "grammar" ? undefined : "fr"}>
                  {b.type === "grammar" ? b.gloss : b.key}
                </span>
                <span className="text-right text-muted">{b.type === "grammar" ? "grammar idea" : b.gloss}</span>
              </li>
            ))}
          </ul>
          {waiting > 0 && (
            <Link href="/review?intensity=steady" className="btn-primary mt-5 block text-center">
              Learn these
            </Link>
          )}
        </section>
      )}

      {prompts.length > 0 && (
        <section className="card mt-4 p-5">
          <h2 className="font-display text-2xl">Your turn</h2>
          <p className="eyebrow mt-1">A rehearsal. Nothing is graded.</p>
          <Rehearsal prompts={prompts.map((p) => ({ id: p.id, situation: p.situation, exampleAnswer: p.exampleAnswer }))} />
        </section>
      )}

      {visits.length > 1 && (
        <p className="mt-8 flex flex-wrap gap-2 text-xs">
          {visits.map((v) => (
            <Link
              key={v.visit.id}
              href={`/scenario/${id}?visit=${v.visit.n}`}
              className={`rounded-full px-3 py-1 ${v.visit.n === current.visit.n ? "bg-sage text-sage-ink" : "border border-line text-muted"}`}
            >
              Visit {v.visit.n}
            </Link>
          ))}
        </p>
      )}

      {isLatest && (
        <NextVisitForm
          scenarioId={id}
          label={`Write visit ${current.visit.n + 1}`}
          hasKey={hasKey}
          note={current.absorbed ? undefined : "You can come back sooner, but the new words above will still be fresh."}
        />
      )}
    </Shell>
  );
}

function NextVisitForm({ scenarioId, label, hasKey, note }: { scenarioId: string; label: string; hasKey: boolean; note?: string }) {
  return (
    <form action={nextVisit} className="mt-8">
      <input type="hidden" name="scenarioId" value={scenarioId} />
      <button className="btn-secondary w-full" disabled={!hasKey}>
        {label}
      </button>
      <p className="mt-2 text-xs text-muted">{hasKey ? note : "Set ANTHROPIC_API_KEY in Vercel to write new visits."}</p>
    </form>
  );
}
