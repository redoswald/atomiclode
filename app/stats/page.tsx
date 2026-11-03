import { Shell } from "@/app/components/shell";
import { db, hasDatabase } from "@/db";
import Link from "next/link";
import { vocabStats } from "@/lib/atoms/vocab-stats";
import { activeGoal, goalCoverageSeries, goalView } from "@/lib/goals/goals";
import { LANG_SPECS, langName } from "@/lib/lang";
import { learner } from "@/lib/learner";
import { CoverageChart, XpChart } from "./chart";
import { setDailyGoal } from "@/app/actions/progress";
import { completedLessons, courseLive } from "@/lib/course";
import { DAILY_GOALS, dailyXp, progressFor, weeklyXp } from "@/lib/progress/xp";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  if (!hasDatabase()) {
    return (
      <Shell title="Stats">
        <p className="text-sm text-muted">No database configured.</p>
      </Shell>
    );
  }
  const me = await learner();
  const { lang } = me;
  const s = await vocabStats(db(), me);
  const goal = await activeGoal(db(), me);
  // Opening the view logs today's point, so the line is never a day behind.
  const goalNow = goal ? await goalView(db(), me.userId, goal.id) : undefined;
  const goalSeries = goal ? await goalCoverageSeries(db(), me.userId, goal.id) : [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const progress = await progressFor(db(), me.userId);
  const weeks = weeklyXp(await dailyXp(db(), me.userId, progress.settings.timeZone, 70), progress.today);
  const lessonsDone = courseLive(lang) ? (await completedLessons(db(), me)).size : undefined;
  const goalXp = progress.settings.dailyGoal;

  return (
    <Shell title="Stats" eyebrow="Progress you can read.">
      <section className="card mb-4 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Habit</h2>
          <span className="text-sm text-muted">{progress.totalXp} XP in all</span>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <Stat label="Streak" value={progress.streak.days} hint={progress.streak.restDays.length ? `${progress.streak.restDays.length} rest day${progress.streak.restDays.length > 1 ? "s" : ""}` : "days at goal"} />
          <Stat label="Today" value={progress.todayXp} hint={`of ${goalXp} XP`} />
          {lessonsDone !== undefined ? <Stat label="Lessons" value={lessonsDone} hint="finished" /> : <Stat label="This week" value={weeks.at(-1)?.xp ?? 0} hint="XP" />}
        </dl>
        <XpChart weeks={weeks} goal={goalXp} />
        <form action={setDailyGoal} className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Daily goal</span>
          {DAILY_GOALS.map((g) => (
            <button
              key={g.xp}
              name="goal"
              value={g.xp}
              className={`rounded-full px-3 py-1 text-xs ${g.xp === goalXp ? "bg-sage text-sage-ink" : "border border-line text-muted"}`}
            >
              {g.label} · {g.xp} XP (~{g.minutes} min)
            </button>
          ))}
        </form>
        <p className="mt-2 text-xs text-muted">About 2 XP a minute of focused work. One missed day a week is forgiven as a rest day.</p>
      </section>
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
        <p className="mt-1 text-xs text-muted">
          {LANG_SPECS[lang].hasFrequencyList
            ? `Estimated share of everyday ${langName(lang)} text made of words you know, from the frequency list.`
            : `Share of the ${langName(lang)} tourist curriculum (signs, phrases, core words) you know.`}
        </p>
        <CoverageChart series={s.series} />
      </section>

      {goal && goalNow && (
        <section className="card mt-4 p-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-2xl">
              <Link href={`/goal/${goal.id}`}>{goal.title}</Link>
            </h2>
            <span className="font-display text-3xl tabular-nums">{pct(goalNow.coverage)}</span>
          </div>
          <p className="mt-1 text-xs text-muted">Share of your goal text&apos;s words you know. Names don&apos;t count.</p>
          <CoverageChart series={goalSeries} title="Goal text coverage over time" empty="The line starts today." />
        </section>
      )}

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
