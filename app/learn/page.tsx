import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { Shell } from "@/app/components/shell";
import { db, hasDatabase } from "@/db";
import { scenarios } from "@/db/schema";
import { completedLessons, courseFor, courseLive } from "@/lib/course";
import { fadedLessons } from "@/lib/course/fading";
import { levelProgress, pathStates, unitProgress, type LessonState } from "@/lib/course/path";
import { langName } from "@/lib/lang";
import { learner } from "@/lib/learner";

export const dynamic = "force-dynamic";

export default async function LearnPage() {
  if (!hasDatabase()) {
    return (
      <Shell title="Learn">
        <p className="text-sm text-muted">No database configured.</p>
      </Shell>
    );
  }
  const me = await learner();
  const course = courseFor(me.lang);
  if (!course || !courseLive(me.lang)) {
    return (
      <Shell title="Learn" eyebrow="A path of short lessons.">
        <p className="card p-5 text-sm leading-6 text-muted">
          There is no {langName(me.lang)} course yet. New words come from scenes and your reading, as before.
        </p>
      </Shell>
    );
  }

  const d = db();
  const done = await completedLessons(d, me);
  const path = pathStates(course, done);
  const faded = await fadedLessons(d, me);
  const slugs = course.units.flatMap((u) => u.scenes);
  const sceneRows = slugs.length
    ? await d
        .select({ id: scenarios.id, slug: scenarios.slug, title: scenarios.title })
        .from(scenarios)
        .where(and(eq(scenarios.userId, me.userId), inArray(scenarios.slug, slugs)))
    : [];
  const sceneBySlug = new Map(sceneRows.map((s) => [s.slug, s]));

  return (
    <Shell title="Learn" eyebrow="Short lessons that introduce new words. Finishing one sends its words to review.">
      <div className="flex flex-col gap-8">
        {course.units.map((unit, ui) => {
          const steps = path.filter((p) => p.unit.id === unit.id);
          const progress = unitProgress(unit, done);
          return (
            <section key={unit.id}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-2xl">
                  Unit {ui + 1} · {unit.title}
                </h2>
                <span className="text-xs text-muted">
                  {unit.cefr} · {progress.done} of {progress.total} · {unit.cefr.split(".")[0]} {Math.round(levelProgress(course, done, unit.cefr.split(".")[0]) * 100)}%
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden>
                <div className="h-full rounded-full bg-sage" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {unit.canDo.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <ol className="mt-4 flex flex-col gap-2">
                {steps.map(({ lesson, state, n }) => {
                  const scene = lesson.scene ? sceneBySlug.get(lesson.scene) : undefined;
                  const fade = state === "done" && faded.has(lesson.id);
                  const href =
                    lesson.kind === "checkpoint" ? (scene ? `/scenario/${scene.id}` : undefined) : `/learn/${lesson.id}${fade ? "?refresh=1" : ""}`;
                  return (
                    <li key={lesson.id}>
                      <Step n={n} title={lesson.title} kind={lesson.kind} state={state} faded={fade} href={state === "locked" ? undefined : href} preview={lesson.items.slice(0, 4).map((i) => i.key)} letters={lesson.letters} lang={me.lang} />
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </Shell>
  );
}

function Step({
  n,
  title,
  kind,
  state,
  faded,
  href,
  preview,
  letters,
  lang,
}: {
  n: number;
  title: string;
  kind: string;
  state: LessonState;
  faded: boolean;
  href?: string;
  preview: string[];
  letters?: string[];
  lang: string;
}) {
  const box =
    state === "current"
      ? "border-sage bg-tint-sage"
      : state === "done"
        ? faded
          ? "border-dashed border-line bg-card opacity-75"
          : "border-line bg-card"
        : "border-line bg-card opacity-55";
  const body = (
    <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${box}`}>
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm tabular-nums ${state === "done" ? "bg-sage text-sage-ink" : "border border-line"}`}
        aria-hidden
      >
        {state === "done" ? (faded ? "↻" : "✓") : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-xs text-muted" lang={lang}>
          {kind === "checkpoint" ? "Play the scene and answer its “your turn”" : [...(letters ?? []).map((l) => l.toUpperCase()), ...preview].join(" · ")}
        </p>
      </div>
      <span className="shrink-0 text-sm">
        {state === "current" ? <span className="btn-primary px-3 py-1.5 text-xs">{kind === "checkpoint" ? "Go" : "Start"}</span> : state === "done" ? (faded ? <span className="btn-secondary px-3 py-1.5 text-xs">Refresh</span> : <span className="text-xs text-muted">Replay</span>) : <span className="text-xs text-muted">Locked</span>}
      </span>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
