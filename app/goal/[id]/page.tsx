import Link from "next/link";
import { notFound } from "next/navigation";
import { makeActive, prepare, sceneFromGoal, writeRung } from "@/app/actions/goal";
import { Shell } from "@/app/components/shell";
import { db, hasDatabase } from "@/db";
import { atoms } from "@/db/schema";
import { currentPhase } from "@/lib/atoms/phase";
import { goalView, rungGate, type GoalSection, type Rung } from "@/lib/goals/goals";
import { LEVELS, type Level } from "@/lib/llm/adapt";
import { hasAnthropicKey } from "@/lib/llm/client";
import { inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const pct = (x: number) => `${Math.round(x * 100)}%`;

export default async function GoalPage({ params, searchParams }: PageProps<"/goal/[id]">) {
  const { id } = await params;
  const { error } = await searchParams;
  if (!hasDatabase() || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = db();
  const [view, { phase }] = await Promise.all([goalView(d, id), currentPhase(d)]);
  if (!view) notFound();
  const { goal } = view;
  const hasKey = hasAnthropicKey();
  const grammar = goal.grammarAtomIds.length
    ? await d.select({ id: atoms.id, gloss: atoms.gloss, status: atoms.status, receptiveOnly: atoms.receptiveOnly }).from(atoms).where(inArray(atoms.id, goal.grammarAtomIds))
    : [];
  const gates = Object.fromEntries((Object.keys(LEVELS) as Level[]).map((l) => [l, rungGate(l, view.knownAtoms, phase)])) as Record<Level, string | undefined>;
  const closed = [...new Set(Object.values(gates).filter((g): g is string => Boolean(g)))];

  return (
    <Shell back={{ href: "/", label: "Home" }}>
      <p className="eyebrow">{view.reached ? "Goal · read" : goal.status === "active" ? "Your goal" : "Waiting"}</p>
      <h1 className="font-display mt-2 text-4xl leading-tight">{goal.title}</h1>
      {typeof error === "string" && <p className="mt-3 text-sm text-bad">{error}</p>}

      <section className="card mt-6 p-5">
        {view.reached ? (
          <p className="font-display text-3xl">You read it.</p>
        ) : (
          <>
            <p className="font-display text-5xl tabular-nums leading-none">{pct(view.coverage)}</p>
            <p className="eyebrow mt-2">of its words known</p>
          </>
        )}
        <p className="mt-4 text-sm text-muted">
          {view.wordCount} words · {view.unknownLemmas} you don&apos;t know yet · {view.queued} of those worth a card
          {view.unknownLemmas > view.queued && ", the rest are one-offs the reader will gloss in place"}.
        </p>
        <p className="mt-2 text-sm text-muted">
          {phase === "foundation"
            ? "You're still building the foundation, so for now this text steers which words your scenes pick up. Once you're reading, its words come first."
            : "Its words come first when you learn something new."}
        </p>
        {goal.status === "waiting" && (
          <form action={makeActive} className="mt-4">
            <input type="hidden" name="goalId" value={id} />
            <button className="btn-secondary w-full text-sm">Make this the active goal</button>
          </form>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl">The ladder</h2>
        <p className="eyebrow mt-1">Gist · comfortable · balanced · challenging · the original</p>
        <ul className="mt-4 space-y-3">
          {view.sections.map((s, i) => (
            <li key={s.passage.id} className="card p-4">
              <SectionLadder goalId={id} section={s} index={i} count={view.sections.length} gates={gates} hasKey={hasKey} />
            </li>
          ))}
        </ul>
        {closed.map((c) => (
          <p key={c} className="mt-3 text-xs text-muted">
            {c}
          </p>
        ))}
        {!hasKey && <p className="mt-3 text-xs text-muted">Set ANTHROPIC_API_KEY in Vercel to write rungs.</p>}
      </section>

      <section className="card mt-8 p-5">
        <h2 className="font-display text-2xl">What it leans on</h2>
        {goal.surveyedAt ? (
          <>
            {grammar.length === 0 && <p className="mt-2 text-sm text-muted">No grammar here that you haven&apos;t met.</p>}
            <ul className="mt-3 space-y-2 text-sm">
              {grammar.map((g) => (
                <li key={g.id} className="flex items-baseline justify-between gap-4">
                  <span>{g.gloss}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {g.receptiveOnly ? "to read, never to say · " : ""}
                    {g.status === "new" ? "waiting" : "in your reviews"}
                  </span>
                </li>
              ))}
            </ul>
            {goal.sceneIdeas.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <p className="eyebrow">Scenes from this text</p>
                {goal.sceneIdeas.map((idea, idx) => (
                  <form key={idea} action={sceneFromGoal} className="mt-3 flex items-start justify-between gap-3">
                    <input type="hidden" name="goalId" value={id} />
                    <input type="hidden" name="idea" value={idx} />
                    <span className="text-sm">{idea}</span>
                    <button className="btn-secondary shrink-0 px-3 py-1.5 text-xs" disabled={!hasKey}>
                      Write it
                    </button>
                  </form>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">Have the text surveyed for the grammar it leans on, and its words glossed so they can become cards.</p>
        )}
        <form action={prepare} className="mt-4">
          <input type="hidden" name="goalId" value={id} />
          <button className="btn-secondary w-full text-sm" disabled={!hasKey}>
            {goal.surveyedAt ? "Gloss more of its words" : "Prepare this text"}
          </button>
        </form>
      </section>
    </Shell>
  );
}

function SectionLadder({
  goalId,
  section,
  index,
  count,
  gates,
  hasKey,
}: {
  goalId: string;
  section: GoalSection;
  index: number;
  count: number;
  gates: Record<Level, string | undefined>;
  hasKey: boolean;
}) {
  return (
    <>
      <p className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{count === 1 ? "The text" : `Section ${index + 1} of ${count}`}</span>
        <span className="text-xs text-muted tabular-nums">
          {pct(section.coverage)} known · {section.wordCount} words
        </span>
      </p>
      <form action={writeRung} className="mt-3 flex flex-wrap gap-2 text-xs">
        <input type="hidden" name="goalId" value={goalId} />
        <input type="hidden" name="passageId" value={section.passage.id} />
        {section.rungs.map((r) => (
          <RungChip key={r.level} rung={r} recommended={section.recommended?.level === r.level} gate={r.level === "original" ? undefined : gates[r.level]} hasKey={hasKey} />
        ))}
      </form>
    </>
  );
}

function RungChip({ rung, recommended, gate, hasKey }: { rung: Rung; recommended: boolean; gate?: string; hasKey: boolean }) {
  const label = rung.level === "original" ? "Original" : LEVELS[rung.level].label;
  if (rung.passageId) {
    return (
      <span className="flex items-center gap-1">
        <Link href={`/read/${rung.passageId}`} className={`rounded-full px-3 py-1.5 ${recommended ? "bg-sage text-sage-ink" : "bg-tint-sage"}`}>
          {label} · {pct(rung.coverage ?? 0)}
        </Link>
        {rung.stale && rung.level !== "original" && !gate && (
          <button name="level" value={`${rung.level}!`} className="text-muted underline" disabled={!hasKey} title="You've outgrown this one">
            rewrite
          </button>
        )}
      </span>
    );
  }
  return (
    <button name="level" value={rung.level} className="rounded-full border border-line px-3 py-1.5 text-muted disabled:opacity-50" disabled={!hasKey || Boolean(gate)}>
      {label}
    </button>
  );
}
