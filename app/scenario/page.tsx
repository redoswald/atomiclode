import Link from "next/link";
import { createScenario } from "@/app/actions/scenario";
import { Shell } from "@/app/components/shell";
import { db, hasDatabase } from "@/db";
import { hasAnthropicKey } from "@/lib/llm/client";
import { scenarioStates, suggestVisit, type ScenarioState } from "@/lib/scenarios/visits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ScenariosPage({ searchParams }: PageProps<"/scenario">) {
  const { error } = await searchParams;
  if (!hasDatabase()) {
    return (
      <Shell title="Scenes">
        <p className="text-sm text-muted">No database configured.</p>
      </Shell>
    );
  }
  const hasKey = hasAnthropicKey();
  const states = await scenarioStates(db());
  const suggestion = suggestVisit(states, hasKey);

  return (
    <Shell title="Scenes" eyebrow="Places you'll stand. Things you'll say.">
      {typeof error === "string" && <p className="mb-4 text-sm text-bad">{error}</p>}
      {states.length === 0 && <p className="text-sm text-muted">No scenarios yet. Redeploy, or run npm run db:prepare: the build seeds them.</p>}

      <ul className="space-y-3">
        {states.map((s) => (
          <li key={s.scenario.id}>
            <Link href={`/scenario/${s.scenario.id}`} className={`card block p-4 ${suggestion?.scenario.id === s.scenario.id ? "border-sage" : ""}`}>
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-display text-2xl leading-tight" lang="fr">
                  {s.scenario.title || "Sans titre"}
                </span>
                <span className="shrink-0 text-xs text-muted">{statusLine(s, hasKey)}</span>
              </span>
              <span className="mt-1 block text-sm text-muted">{s.scenario.brief}</span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="card mt-8 p-5">
        <h2 className="font-display text-2xl">Somewhere you&apos;ll actually be</h2>
        <p className="eyebrow mt-1">Your own situation, in a sentence.</p>
        <form action={createScenario} className="mt-4">
          <textarea
            name="situation"
            rows={2}
            required
            minLength={10}
            maxLength={400}
            placeholder="Meeting her grandmother on Sunday. She speaks no English and loves her garden."
            className="field w-full resize-none text-sm"
            disabled={!hasKey}
          />
          <button className="btn-primary mt-3 w-full" disabled={!hasKey}>
            Write the first visit
          </button>
        </form>
        {!hasKey && <p className="mt-3 text-xs text-muted">Set ANTHROPIC_API_KEY in Vercel to write your own scenes.</p>}
      </section>
    </Shell>
  );
}

function statusLine(s: ScenarioState, hasKey: boolean): string {
  const latest = s.latest;
  if (!latest) return hasKey ? "new" : "";
  if (s.state === "ready") return latest.visit.n === 1 ? "new" : `visit ${latest.visit.n} ready`;
  if (s.state === "learning") return `visit ${latest.visit.n} · ${latest.introduced} of ${latest.visit.bundle.length} learned`;
  return hasKey ? `ready for visit ${latest.visit.n + 1}` : `visit ${latest.visit.n} done`;
}
