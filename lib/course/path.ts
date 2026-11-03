/**
 * The locked path (SPEC §17). Pure: given the course and the lessons a learner
 * has finished, what is done, what is next, what is locked, and which scenes
 * are open. Lessons open one at a time in order; a unit opens when the last
 * one's checkpoint is done.
 */
import type { Course, Lesson, Unit } from "./types";

export type LessonState = "done" | "current" | "locked";

export interface LessonOnPath {
  lesson: Lesson;
  unit: Unit;
  state: LessonState;
  /** 1-based position within its unit. */
  n: number;
}

export function pathStates(course: Course, done: Set<string>): LessonOnPath[] {
  const out: LessonOnPath[] = [];
  let open = true;
  for (const unit of course.units) {
    unit.lessons.forEach((lesson, i) => {
      const isDone = done.has(lesson.id);
      out.push({ lesson, unit, state: isDone ? "done" : open ? "current" : "locked", n: i + 1 });
      // Only the first unfinished lesson is open; everything after it waits.
      if (!isDone) open = false;
    });
  }
  return out;
}

/** The lesson to continue with, or undefined when the whole course is done. */
export function nextLesson(course: Course, done: Set<string>): LessonOnPath | undefined {
  return pathStates(course, done).find((p) => p.state === "current");
}

/** A unit is open once its first lesson is reachable. */
export function unitOpen(course: Course, done: Set<string>, unitId: string): boolean {
  const first = pathStates(course, done).find((p) => p.unit.id === unitId);
  return first !== undefined && first.state !== "locked";
}

/**
 * Scenes follow the path: a unit's scenes open with the unit; a scene listed in
 * no unit opens once the last unit's checkpoint is done.
 */
export function sceneOpen(course: Course, done: Set<string>, slug: string): boolean {
  const unit = course.units.find((u) => u.scenes.includes(slug));
  if (unit) return unitOpen(course, done, unit.id);
  const lastCheckpoint = course.units.at(-1)?.lessons.at(-1);
  return lastCheckpoint !== undefined && done.has(lastCheckpoint.id);
}

/** Progress through a CEFR level ("A1 · 35%"): lessons done across the units whose label starts with it. */
export function levelProgress(course: Course, done: Set<string>, level: string): number {
  const lessons = course.units.filter((u) => u.cefr.startsWith(level)).flatMap((u) => u.lessons);
  return lessons.length ? lessons.filter((l) => done.has(l.id)).length / lessons.length : 0;
}

/** Progress through a unit, for "Unit 1 · 7 of 14". */
export function unitProgress(unit: Unit, done: Set<string>): { done: number; total: number } {
  return { done: unit.lessons.filter((l) => done.has(l.id)).length, total: unit.lessons.length };
}
