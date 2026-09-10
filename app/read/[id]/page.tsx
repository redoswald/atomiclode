import Link from "next/link";
import { notFound } from "next/navigation";
import { adapt } from "@/app/actions/adapt";
import { Shell } from "@/app/components/shell";
import { db, hasDatabase } from "@/db";
import { LEVELS, type Level } from "@/lib/llm/adapt";
import { hasAnthropicKey } from "@/lib/llm/client";
import { adaptationsOf } from "@/lib/reader/library";
import { openPassage } from "@/lib/reader/passages";
import { readingMinutes } from "@/lib/reader/reading";
import { Reader } from "./reader";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function PassagePage({ params, searchParams }: PageProps<"/read/[id]">) {
  const { id } = await params;
  const { reused, error } = await searchParams;
  if (!hasDatabase() || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const view = await openPassage(db(), id);
  if (!view) notFound();
  const isAdaptation = view.sourceRef?.startsWith("passage:") ?? false;
  const originalId = isAdaptation ? view.sourceRef!.slice("passage:".length).split("#")[0] : undefined;
  const adaptations = isAdaptation ? {} : await adaptationsOf(db(), id);
  const hasKey = hasAnthropicKey();

  return (
    <Shell back={{ href: "/read", label: "Reader" }}>
      <p className="flex items-baseline justify-between text-sm text-muted tabular-nums">
        <span>
          {Math.round(view.coverage * 100)}% known · {view.unknownCount} new {view.unknownCount === 1 ? "word" : "words"}
        </span>
        <span>{readingMinutes(view.wordCount)} min</span>
      </p>
      {reused === "1" && <p className="mt-2 text-xs text-muted">From your library: this passage fits what you know today.</p>}
      {typeof error === "string" && <p className="mt-2 text-sm text-bad">{error}</p>}

      <h1 className="font-display mt-3 text-4xl leading-tight">{view.title ?? "Untitled"}</h1>
      {view.sourceRef && !isAdaptation && (
        <a href={view.sourceRef} className="mt-1 block truncate text-xs text-muted underline" target="_blank" rel="noreferrer">
          Open original ↗
        </a>
      )}
      {originalId && (
        <Link href={`/read/${originalId}`} className="mt-1 block text-xs text-muted underline">
          Adapted from the original passage
        </Link>
      )}

      <Reader view={view} canGloss={hasKey} />

      {!isAdaptation && (
        <section className="card mt-10 p-5">
          <h2 className="font-display text-2xl">Adapt this text</h2>
          <p className="eyebrow mt-1">Same meaning. A clearer path.</p>
          <form action={adapt} className="mt-4 grid grid-cols-3 gap-2">
            <input type="hidden" name="passageId" value={id} />
            {(Object.keys(LEVELS) as Level[]).map((level) => {
              const l = LEVELS[level];
              const existing = adaptations[level];
              return existing ? (
                <Link key={level} href={`/read/${existing}`} className="rounded-xl bg-tint-sage p-3 text-left text-xs">
                  <span className="block text-sm font-medium">{l.label}</span>
                  <span className="text-muted">{Math.round(l.targetCoverage * 100)}% known · ready</span>
                </Link>
              ) : (
                <button key={level} name="level" value={level} className="rounded-xl border border-line p-3 text-left text-xs" disabled={!hasKey}>
                  <span className="block text-sm font-medium">{l.label}</span>
                  <span className="text-muted">{Math.round(l.targetCoverage * 100)}% known</span>
                  <span className="mt-1 block text-muted">{l.blurb}</span>
                </button>
              );
            })}
          </form>
          {!hasKey && <p className="mt-3 text-xs text-muted">Set ANTHROPIC_API_KEY in Vercel to adapt texts.</p>}
        </section>
      )}
    </Shell>
  );
}
