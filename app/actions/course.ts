"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import type { ItemStats } from "@/lib/course/exercises";
import { completeCheckpoint, completeLesson, completeRefresh, type LessonResult } from "@/lib/course/lesson";
import { learner } from "@/lib/learner";
import { awardXp, XP } from "@/lib/progress/xp";

/** The end of a lesson: hand its items to review (SPEC §17). */
export async function finishLesson(input: { lessonId: string; stats: Record<string, ItemStats> }): Promise<LessonResult | { error: string }> {
  const me = await learner();
  try {
    const result = await completeLesson(db(), me, input.lessonId, input.stats);
    // A first play earns the lesson (and a bonus if nothing was missed); a replay a little (SPEC §18).
    const clean = Object.values(input.stats).every((s) => s.firstTimeRight);
    if (result.replay) await awardXp(db(), me, "lesson", XP.lessonReplay);
    else await awardXp(db(), me, "lesson", XP.lesson + (clean ? XP.lessonClean : 0), input.lessonId);
    revalidatePath("/learn");
    revalidatePath("/");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** A faded lesson's Refresh: its slipping words, practised, count as reviews (SPEC §17). */
export async function finishRefresh(input: { lessonId: string; stats: Record<string, ItemStats> }): Promise<{ reviewed: number } | { error: string }> {
  const me = await learner();
  try {
    const result = await completeRefresh(db(), me, input.lessonId, input.stats);
    await awardXp(db(), me, "refresh", XP.refresh);
    revalidatePath("/learn");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** The unit's checkpoint scene, played through. */
export async function finishCheckpoint(lessonId: string): Promise<{ ok: true } | { error: string }> {
  const me = await learner();
  try {
    await completeCheckpoint(db(), me, lessonId);
    revalidatePath("/learn");
    revalidatePath("/scenario");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
