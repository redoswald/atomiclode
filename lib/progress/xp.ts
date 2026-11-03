/**
 * Experience, the daily goal and the streak (SPEC §18). XP is earned for real
 * work at about 2 XP a minute, so a daily goal reads as minutes. Everything
 * shown is derived from the append-only `xp_events` log.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { userSettings, xpEvents } from "@/db/schema";
import type { Learner } from "@/lib/learners/provision";

export { DAILY_GOALS, reviewXp, XP, XP_PER_MINUTE, type XpKind } from "./rules";
import type { XpKind } from "./rules";

/** Record XP. With a `ref`, a second award of the same kind and ref is ignored. */
export async function awardXp(d: Db, me: Learner, kind: XpKind, amount: number, ref?: string, at = new Date()): Promise<void> {
  if (amount <= 0) return;
  await d
    .insert(xpEvents)
    .values({ userId: me.userId, lang: me.lang, kind, amount, ref: ref ?? null, at: at.toISOString() })
    .onConflictDoNothing();
}

export interface Settings {
  dailyGoal: number;
  timeZone: string;
}

export function validTimeZone(tz: string | undefined | null): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

export async function getSettings(d: Db, userId: string): Promise<Settings> {
  const [row] = await d.select().from(userSettings).where(eq(userSettings.userId, userId));
  return { dailyGoal: row?.dailyGoal ?? 40, timeZone: validTimeZone(row?.timeZone) ?? "UTC" };
}

export async function saveSettings(d: Db, userId: string, patch: Partial<Settings>): Promise<void> {
  const value = {
    ...(patch.dailyGoal !== undefined ? { dailyGoal: patch.dailyGoal } : {}),
    ...(patch.timeZone !== undefined ? { timeZone: patch.timeZone } : {}),
    updatedAt: new Date().toISOString(),
  };
  await d
    .insert(userSettings)
    .values({ userId, ...value })
    .onConflictDoUpdate({ target: userSettings.userId, set: value });
}

/** The calendar day of an instant in a time zone, as YYYY-MM-DD. */
export function dayIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** XP per local day, all tracks together (the goal and the streak are the learner's, not a track's). */
export async function dailyXp(d: Db, userId: string, timeZone: string, sinceDays = 120, now = new Date()): Promise<Map<string, number>> {
  const since = new Date(now.getTime() - (sinceDays + 1) * 86_400_000).toISOString();
  const rows = await d
    .select({ at: xpEvents.at, amount: xpEvents.amount })
    .from(xpEvents)
    .where(and(eq(xpEvents.userId, userId), gte(xpEvents.at, since)));
  const out = new Map<string, number>();
  for (const r of rows) {
    const day = dayIn(new Date(r.at), timeZone);
    out.set(day, (out.get(day) ?? 0) + r.amount);
  }
  return out;
}

export interface Streak {
  /** Days the goal was met, in the current run. */
  days: number;
  /** Missed days forgiven inside the run (one a week at most). */
  restDays: string[];
  /** Today's goal is already met. */
  today: boolean;
}

/**
 * The streak (SPEC §18): consecutive days the goal was met, counting back from
 * today (or from yesterday while today is still open). One missed day in any
 * seven is forgiven as a rest day; a second ends the run. Rest days don't count.
 */
export function streak(daily: Map<string, number>, goal: number, today: string): Streak {
  const met = (day: string) => (daily.get(day) ?? 0) >= goal;
  const restDays: string[] = [];
  let days = 0;
  const todayMet = met(today);
  let day = todayMet ? today : addDays(today, -1);
  for (let guard = 0; guard < 1000; guard++) {
    if (met(day)) {
      days++;
    } else {
      const lastRest = restDays.at(-1);
      // A rest sits between met days (or is yesterday, while today is still open), never
      // within 7 days of the last one.
      const started = days > 0 || (!todayMet && day === addDays(today, -1));
      const restOk = started && (!lastRest || dayDiff(lastRest, day) >= 7);
      if (!restOk || !met(addDays(day, -1))) break;
      restDays.push(day);
    }
    day = addDays(day, -1);
  }
  return { days, restDays, today: todayMet };
}

function dayDiff(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
}

/** XP per week (Monday-start, local), most recent last, for the Stats chart. */
export function weeklyXp(daily: Map<string, number>, today: string, weeks = 8): Array<{ week: string; xp: number }> {
  const t = new Date(`${today}T12:00:00Z`);
  const monday = addDays(today, -((t.getUTCDay() + 6) % 7));
  const out: Array<{ week: string; xp: number }> = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(monday, -7 * w);
    let xp = 0;
    for (let i = 0; i < 7; i++) xp += daily.get(addDays(start, i)) ?? 0;
    out.push({ week: start, xp: Math.round(xp) });
  }
  return out;
}

export interface Progress {
  settings: Settings;
  today: string;
  todayXp: number;
  streak: Streak;
  totalXp: number;
}

export async function progressFor(d: Db, userId: string, now = new Date()): Promise<Progress> {
  const settings = await getSettings(d, userId);
  const today = dayIn(now, settings.timeZone);
  const daily = await dailyXp(d, userId, settings.timeZone, 400, now);
  const [total] = await d
    .select({ xp: sql<number>`coalesce(sum(${xpEvents.amount}), 0)::float` })
    .from(xpEvents)
    .where(eq(xpEvents.userId, userId));
  return {
    settings,
    today,
    todayXp: Math.round(daily.get(today) ?? 0),
    streak: streak(daily, settings.dailyGoal, today),
    totalXp: Math.round(total?.xp ?? 0),
  };
}
