/**
 * Courses by track (SPEC §17), and whether a track's course is live. While a
 * course isn't live the track works as before: review introduces words on its
 * own (the §16 script planner for Greek) and every scene is open. A course goes
 * live once the lesson player can introduce its words (milestone 14).
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { lessonProgress } from "@/db/schema";
import courseEl from "@/db/seed/course-el.json";
import type { Lang } from "@/lib/lang";
import type { Learner } from "@/lib/learners/provision";
import type { Course } from "./types";

export const COURSES: Partial<Record<Lang, Course>> = {
  el: courseEl as Course,
};

/** Flipped to true for a track when its lessons can be played. */
export const COURSE_LIVE: Record<Lang, boolean> = { fr: false, el: true };

export function courseFor(lang: Lang): Course | undefined {
  return COURSES[lang];
}

export function courseLive(lang: Lang): boolean {
  return COURSE_LIVE[lang] && Boolean(COURSES[lang]);
}

/** Lesson ids the learner has finished on this track. */
export async function completedLessons(d: Db, me: Learner): Promise<Set<string>> {
  const rows = await d
    .select({ id: lessonProgress.lessonId })
    .from(lessonProgress)
    .where(and(eq(lessonProgress.userId, me.userId), eq(lessonProgress.lang, me.lang)));
  return new Set(rows.map((r) => r.id));
}
