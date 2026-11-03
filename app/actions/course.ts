"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import type { ItemStats } from "@/lib/course/exercises";
import { completeCheckpoint, completeLesson, type LessonResult } from "@/lib/course/lesson";
import { learner } from "@/lib/learner";

/** The end of a lesson: hand its items to review (SPEC §17). */
export async function finishLesson(input: { lessonId: string; stats: Record<string, ItemStats> }): Promise<LessonResult | { error: string }> {
  const me = await learner();
  try {
    const result = await completeLesson(db(), me, input.lessonId, input.stats);
    revalidatePath("/learn");
    revalidatePath("/");
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
