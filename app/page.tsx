import Link from "next/link";
import { db, hasDatabase } from "@/db";
import { homeCounts, type HomeCounts } from "@/lib/atoms/stats";
import { signOut } from "@/app/actions/auth";
import { authEnabled, getUser } from "@/lib/auth";
import { learner } from "@/lib/learner";
import { completedLessons, courseFor, courseLive } from "@/lib/course";
import { nextLesson, unitProgress } from "@/lib/course/path";
import { activeGoal, goalCoverageWeekAgo, goalView, type GoalView } from "@/lib/goals/goals";
import { langName } from "@/lib/lang";
import { hasAnthropicKey } from "@/lib/llm/client";
import { listPassages } from "@/lib/reader/passages";
import { BUDGETS, DEFAULT_NEW_PER_DAY, ROUND_MIN } from "@/lib/review/session";
import { progressFor } from "@/lib/progress/xp";
import { scenarioStates, suggestVisit, type ScenarioState } from "@/lib/scenarios/visits";
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
  let scenes: ScenarioState[];
  let goal: GoalView | undefined;
  let goalWeekAgo: number | undefined;
  // Outside the try: a redirect to /login must not be caught as a database error.
  const me = await learner();
  const { lang } = me;
  const user = await getUser();
  try {
    const active = await activeGoal(db(), me);
    [counts, [latest], scenes, goal] = await Promise.all([
      homeCounts(db(), me),
      listPassages(db(), me),
      scenarioStates(db(), me),
      active ? goalView(db(), me.userId, active.id) : undefined,
    ]);
    if (active) goalWeekAgo = await goalCoverageWeekAgo(db(), me.userId, active.id);
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

  // The course leads on a track that has one (SPEC §17): the next lesson, and the unit's progress.
  const course = courseLive(lang) ? courseFor(lang) : undefined;
  const done = course ? await completedLessons(db(), me) : new Set<string>();
  const next = course ? nextLesson(course, done) : undefined;
  const progress = next ? unitProgress(next.unit, done) : undefined;

  const glossedNew = Math.max(0, counts.newAvailable.word - counts.unglossed);
  const newTotal = glossedNew + counts.newAvailable.chunk + counts.newAvailable.grammar;
  const refreshMin = Math.round((counts.dueNow * MODALITY_SECONDS.recall) / 60);
  const rounds = Math.max(1, Math.ceil(refreshMin / ROUND_MIN));
  const habit = await progressFor(db(), me.userId);
  const learnMin = Math.round((Math.min(newTotal, DEFAULT_NEW_PER_DAY) * MODALITY_SECONDS.recognize * 2) / 60);
  const recommended = recommend(refreshMin + learnMin);
  const hasKey = hasAnthropicKey();
  // The Learn row names where the new atoms come from (SPEC §8): a visit under way, or the next one on offer.
  const underWay = scenes.find((s) => s.state === "learning");
  const offered = underWay ? undefined : suggestVisit(scenes, hasKey);
  const goalUp = goal && goalWeekAgo !== undefined ? Math.round((goal.coverage - goalWeekAgo) * 100) : 0;

  return (
    <Shell
      aside={
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>
            {langName(lang)} · Day {counts.day}
            <span className="text-muted">
              {habit.streak.days > 0 ? ` · ${habit.streak.days}-day streak` : ` · ${counts.reviewsTotal} reviews so far`}
            </span>
          </span>
          <Link href="/stats" className="flex shrink-0 items-center gap-2 text-xs tabular-nums" aria-label={`${habit.todayXp} of ${habit.settings.dailyGoal} XP today`}>
            <GoalRing value={habit.todayXp} goal={habit.settings.dailyGoal} />
            {habit.todayXp} / {habit.settings.dailyGoal} XP today
          </Link>
        </div>
      }
    >
      {!authEnabled() && (
        <p className="mb-5 rounded-xl border border-tint-sand bg-tint-sand/50 px-3 py-2 text-xs">
          Open to anyone with the URL. Set <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
          <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and{" "}
          <code className="font-mono">ALLOWED_EMAILS</code> in Vercel and redeploy to require a suite sign-in.
        </p>
      )}

      {course && (
        <section className="card mb-4 p-5">
          {next && progress ? (
            <>
              <p className="eyebrow">
                Continue · {next.unit.title}, lesson {next.n}
              </p>
              <div className="mt-1 flex items-center justify-between gap-3">
                <h2 className="font-display min-w-0 truncate text-2xl">{next.lesson.title}</h2>
                <Link href={next.lesson.kind === "checkpoint" ? "/learn" : `/learn/${next.lesson.id}`} className="btn-primary shrink-0 px-4 py-2 text-sm">
                  Start
                </Link>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden>
                <div className="h-full rounded-full bg-sage" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {progress.done} of {progress.total} · {next.unit.cefr}
              </p>
            </>
          ) : (
            <p className="text-sm">The course is done for now. More units are coming.</p>
          )}
        </section>
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

        <Row href="/review?intensity=steady" title="Review" note={counts.dueNow === 0 ? "nothing due" : `~${Math.max(1, refreshMin)} min`}>
          {counts.dueNow === 0
            ? "Nothing due"
            : `${counts.dueNow} due · ${rounds === 1 ? "one round" : `${rounds} rounds of about 5 min`}`}
        </Row>
        {underWay?.latest ? (
          <Row href="/review?intensity=steady" title="Learn" note={`~${Math.max(1, learnMin)} min`}>
            <span lang={lang}>{underWay.scenario.title}</span>, visit {underWay.latest.visit.n} · {underWay.latest.visit.bundle.length - underWay.latest.introduced} still to come
          </Row>
        ) : offered ? (
          <Row href={`/scenario/${offered.scenario.id}`} title="Learn" note={offered.visit ? "a new scene" : "to be written"}>
            <span lang={lang}>{offered.scenario.title}</span>, visit {offered.n}
            {offered.visit && ` · ${offered.visit.bundle.length} new`}
          </Row>
        ) : course ? null : (
          <Row href="/review?intensity=steady" title="Learn" note={newTotal === 0 ? "all introduced" : `~${Math.max(1, learnMin)} min`}>
            {glossedNew} new {plural(glossedNew, "word")} · {counts.newAvailable.chunk} {plural(counts.newAvailable.chunk, "phrase")} ·{" "}
            {counts.newAvailable.grammar} grammar {plural(counts.newAvailable.grammar, "idea")}
          </Row>
        )}
        <Row href={latest ? `/read/${latest.id}` : "/read"} title="Read" note={latest ? `${Math.round(latest.coverage * 100)}% known` : undefined}>
          {latest ? latest.title ?? "Untitled" : <span className="text-muted">Paste a text or an article URL.</span>}
        </Row>
        {goal ? (
          <Row href={`/goal/${goal.goal.id}`} title="Goal" note={`${Math.round(goal.coverage * 100)}% known`}>
            {goal.goal.title}
            {goalUp > 0 && <span className="text-muted"> · up {goalUp} this week</span>}
          </Row>
        ) : (
          <Row href="/goal" title="Goal">
            <span className="text-muted">Something you want to read one day.</span>
          </Row>
        )}
      </section>

      {lang === "fr" && <GlossFiller remaining={counts.unglossed} hasKey={hasKey} />}

      <ExploreBox enabled={hasKey} lang={lang} />

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
      {user && authEnabled() && (
        <form action={signOut} className="mt-8 flex items-baseline justify-between text-xs text-muted">
          <span>Signed in as {user.email}</span>
          <button type="submit" className="underline">
            Sign out
          </button>
        </form>
      )}
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

/** Today's XP toward the daily goal (SPEC §18): a thin ring, full at the goal. */
function GoalRing({ value, goal }: { value: number; goal: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const share = Math.min(1, goal ? value / goal : 0);
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <circle cx="11" cy="11" r={r} fill="none" stroke="var(--line)" strokeWidth="2.5" />
      <circle
        cx="11"
        cy="11"
        r={r}
        fill="none"
        stroke="var(--chart)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${share * c} ${c}`}
        transform="rotate(-90 11 11)"
      />
    </svg>
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
