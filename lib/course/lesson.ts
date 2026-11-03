/**
 * Playing a lesson (SPEC §17): build what the player shows, and hand the
 * lesson's items to review when it's done.
 */
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, introductions, lessonProgress, scenarios, scenarioVisits } from "@/db/schema";
import { displayKey } from "@/lib/atoms/display";
import { LOOKALIKES, scriptUnits } from "@/lib/greek/script";
import { isLang } from "@/lib/lang";
import { SEEDS, type Learner } from "@/lib/learners/provision";
import { introducedMemoryState, spreadFirstReviews } from "@/lib/scheduler/introduce";
import { spokenText } from "@/lib/speech/say";
import { buildExercises, type Exercise, type ItemStats, type LessonItemView } from "./exercises";
import { completedLessons, courseFor } from "./index";
import { pathStates, type LessonOnPath } from "./path";
import type { Lesson } from "./types";

export interface LessonPayload {
  lessonId: string;
  title: string;
  kind: Lesson["kind"];
  unitTitle: string;
  n: number;
  total: number;
  /** A replay of a finished lesson: nothing is handed off again. */
  replay: boolean;
  items: LessonItemView[];
  /** Items from the two lessons before that some exercises revisit. */
  recent: LessonItemView[];
  exercises: Exercise[];
}

const letterKey = (u: string) => `letter:${u}`;

function findOnPath(me: Learner, done: Set<string>, lessonId: string): LessonOnPath {
  const course = courseFor(me.lang);
  if (!course) throw new Error("This track has no course yet.");
  const at = pathStates(course, done).find((p) => p.lesson.id === lessonId);
  if (!at) throw new Error("unknown lesson");
  if (at.state === "locked") throw new Error("That lesson isn't open yet: finish the one before it first.");
  return at;
}

/** Atom keys a lesson introduces, letters first, in teaching order. */
function lessonKeys(lesson: Lesson): string[] {
  return [...(lesson.letters ?? []).map(letterKey), ...lesson.items.map((i) => i.key)];
}

/** A phrase from the seed that uses the word, to meet it in (SPEC §17 Meet). */
function exampleFor(me: Learner, key: string): { text: string; gloss: string } | undefined {
  if (key.includes(" ") || key.startsWith("letter:")) return undefined;
  const chunks = SEEDS[me.lang].files.chunks;
  const hit = chunks.find((c) => c.key.split(/[\s,;?!.…]+/).includes(key));
  return hit ? { text: hit.key, gloss: hit.gloss } : undefined;
}

export async function buildLesson(d: Db, me: Learner, lessonId: string, opts: { canSay: boolean; rnd?: () => number }): Promise<LessonPayload> {
  const done = await completedLessons(d, me);
  const at = findOnPath(me, done, lessonId);
  const { lesson, unit } = at;
  if (lesson.kind === "checkpoint") throw new Error("A checkpoint is played as its scene.");

  // Letters taught by the end of this lesson, and the unit's lessons up to it.
  const course = courseFor(me.lang)!;
  const upTo: Lesson[] = [];
  const taught = new Set<string>();
  for (const u of course.units) {
    for (const l of u.lessons) {
      l.letters?.forEach((x) => taught.add(x));
      if (u.id === unit.id) upTo.push(l);
      if (l.id === lesson.id) break;
    }
    if (u.id === unit.id) break;
  }
  const recentLessons = upTo.filter((l) => l.kind !== "checkpoint" && l.id !== lesson.id).slice(-2);

  const keys = Array.from(new Set(upTo.flatMap(lessonKeys)));
  const rows = await d
    .select()
    .from(atoms)
    .where(and(eq(atoms.userId, me.userId), eq(atoms.lang, me.lang), inArray(atoms.key, keys)));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const modeOf = new Map(upTo.flatMap((l) => l.items.map((i) => [i.key, i.mode] as const)));

  const view = (key: string): LessonItemView | undefined => {
    const r = byKey.get(key);
    if (!r || r.type === "grammar") return undefined;
    const lang = isLang(r.lang) ? r.lang : me.lang;
    const isLetter = r.pos === "LETTER";
    const mode = modeOf.get(key);
    const a = { lang, type: r.type, key: r.key, forms: r.forms, pos: r.pos ?? undefined, gender: r.gender ?? undefined, domains: r.domains };
    const look = isLetter && r.domains.includes("lookalike") ? r.forms.find((f) => LOOKALIKES[f]) : undefined;
    return {
      atomId: r.id,
      key: r.key,
      display: displayKey(a),
      gloss: r.gloss,
      romanization: r.romanization ?? undefined,
      speak: spokenText(a),
      type: r.type,
      isLetter,
      unit: isLetter ? r.key.replace(/^letter:/, "") : undefined,
      mode,
      decodable: !isLetter && mode !== "sight" && scriptUnits(r.key).every((u) => taught.has(u)),
      known: r.status !== "new",
      lookalike: look ? `${look} looks like ${LOOKALIKES[look].looks}, says ${LOOKALIKES[look].says}` : undefined,
      example: exampleFor(me, r.key),
      lang,
    };
  };
  const defined = <T>(x: T | undefined): x is T => x !== undefined;
  const items = lessonKeys(lesson).map(view).filter(defined);
  const recent = recentLessons.flatMap((l) => l.items.map((i) => view(i.key))).filter(defined);
  const pool = keys.map(view).filter(defined);

  return {
    lessonId: lesson.id,
    title: lesson.title,
    kind: lesson.kind,
    unitTitle: unit.title,
    n: at.n,
    total: unit.lessons.length,
    replay: at.state === "done",
    items,
    recent,
    exercises: buildExercises({ items, recent, pool, canSay: opts.canSay }, opts.rnd),
  };
}

export interface LessonResult {
  /** Items handed to review now. */
  added: number;
  /** Items the learner already had, taught again but not handed off. */
  alreadyKnown: number;
  replay: boolean;
}

/**
 * The hand-off (SPEC §17): every item still new gets an `introductions` row and
 * the state a lesson gives it, first due on a later day, spread when a day is
 * heavy. Items with memory state keep it. The lesson is marked done (a replay
 * counts another play).
 */
export async function completeLesson(d: Db, me: Learner, lessonId: string, stats: Record<string, ItemStats>, now = new Date()): Promise<LessonResult> {
  const done = await completedLessons(d, me);
  const { lesson } = findOnPath(me, done, lessonId);
  if (lesson.kind === "checkpoint") throw new Error("A checkpoint is passed in its scene.");
  const replay = done.has(lessonId);

  const keys = lessonKeys(lesson);
  const rows = await d
    .select({ id: atoms.id, key: atoms.key, status: atoms.status })
    .from(atoms)
    .where(and(eq(atoms.userId, me.userId), eq(atoms.lang, me.lang), inArray(atoms.key, keys)));
  const order = new Map(keys.map((k, i) => [k, i]));
  const fresh = rows.filter((r) => r.status === "new").sort((a, b) => order.get(a.key)! - order.get(b.key)!);

  if (fresh.length) {
    const booked = await d
      .select({ day: sql<string>`to_char(${introductions.due} at time zone 'UTC', 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
      .from(introductions)
      .where(and(eq(introductions.userId, me.userId), gte(introductions.due, now.toISOString())))
      .groupBy(sql`1`);
    const dues = spreadFirstReviews(now, fresh.length, new Map(booked.map((b) => [b.day, b.n])));
    const at = now.toISOString();
    for (const [i, r] of fresh.entries()) {
      const s = stats[r.id] ?? { attempts: 1, misses: 0, firstTimeRight: true };
      const intro = { at, due: dues[i], firstTimeRight: s.firstTimeRight };
      const m = introducedMemoryState(intro);
      await d
        .insert(introductions)
        .values({ userId: me.userId, atomId: r.id, lessonId, ...intro, attempts: Math.max(0, s.attempts), misses: Math.max(0, s.misses) })
        .onConflictDoNothing();
      await d
        .update(atoms)
        .set({
          stability: m.stability,
          difficulty: m.difficulty,
          due: m.due,
          lastReview: m.lastReview,
          reps: m.reps,
          lapses: m.lapses,
          status: m.status,
          learningSteps: m.learningSteps,
          scheduledDays: m.scheduledDays,
        })
        .where(and(eq(atoms.id, r.id), eq(atoms.userId, me.userId), eq(atoms.status, "new")));
    }
  }

  await d
    .insert(lessonProgress)
    .values({ userId: me.userId, lang: me.lang, lessonId, completedAt: now.toISOString() })
    .onConflictDoUpdate({ target: [lessonProgress.userId, lessonProgress.lessonId], set: { plays: sql`${lessonProgress.plays} + 1` } });

  return { added: fresh.length, alreadyKnown: rows.length - fresh.length, replay };
}

/** The checkpoint lesson that is current and plays this scene, if any. */
export async function currentCheckpoint(d: Db, me: Learner, sceneSlug: string): Promise<string | undefined> {
  const course = courseFor(me.lang);
  if (!course) return undefined;
  const at = pathStates(course, await completedLessons(d, me)).find((p) => p.state === "current");
  return at?.lesson.kind === "checkpoint" && at.lesson.scene === sceneSlug ? at.lesson.id : undefined;
}

/** A checkpoint passes once its scene has been opened and its "your turn" answered (SPEC §17). */
export async function completeCheckpoint(d: Db, me: Learner, lessonId: string, now = new Date()): Promise<void> {
  const done = await completedLessons(d, me);
  const { lesson } = findOnPath(me, done, lessonId);
  if (lesson.kind !== "checkpoint" || !lesson.scene) throw new Error("not a checkpoint");
  const [opened] = await d
    .select({ id: scenarioVisits.id })
    .from(scenarioVisits)
    .innerJoin(scenarios, eq(scenarios.id, scenarioVisits.scenarioId))
    .where(and(eq(scenarios.userId, me.userId), eq(scenarios.slug, lesson.scene), isNotNull(scenarioVisits.startedAt)))
    .limit(1);
  if (!opened) throw new Error("Open the scene first.");
  await d
    .insert(lessonProgress)
    .values({ userId: me.userId, lang: me.lang, lessonId, completedAt: now.toISOString() })
    .onConflictDoNothing();
}
