import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, reviewEvents } from "@/db/schema";
import { atomToRow, rowToAtom } from "@/lib/atoms/rows";
import type { Grade, Modality } from "@/lib/atoms/types";
import { MODALITIES } from "@/lib/atoms/types";
import { applyReview } from "@/lib/scheduler";

export interface RecordReviewInput {
  atomId: string;
  modality: Modality;
  grade: Grade;
  responseMs: number;
  sentenceId?: string;
}

export interface RecordReviewResult {
  status: string;
  due: string;
  stability: number;
  lapses: number;
}

/** Append to the review log, then update the atom's cached memory state. */
export async function recordReview(d: Db, input: RecordReviewInput, now = new Date()): Promise<RecordReviewResult> {
  if (![1, 2, 3, 4].includes(input.grade)) throw new Error("grade must be 1–4");
  if (!MODALITIES.includes(input.modality)) throw new Error("unknown modality");
  const at = now.toISOString();

  const [row] = await d.select().from(atoms).where(eq(atoms.id, input.atomId));
  if (!row) throw new Error("unknown atom");

  await d.insert(reviewEvents).values({
    atomId: input.atomId,
    modality: input.modality,
    sentenceId: input.sentenceId ?? null,
    grade: input.grade,
    responseMs: Math.max(0, Math.round(input.responseMs)),
    at,
  });

  const updated = applyReview(rowToAtom(row), {
    atomId: input.atomId,
    modality: input.modality,
    sentenceId: input.sentenceId,
    grade: input.grade,
    responseMs: input.responseMs,
    at,
  });
  const next = atomToRow(updated);
  await d
    .update(atoms)
    .set({
      stability: next.stability,
      difficulty: next.difficulty,
      due: next.due,
      lastReview: next.lastReview,
      reps: next.reps,
      lapses: next.lapses,
      status: next.status,
      learningSteps: next.learningSteps,
      scheduledDays: next.scheduledDays,
      modality: next.modality,
    })
    .where(eq(atoms.id, input.atomId));

  return {
    status: updated.memory.status,
    due: updated.memory.due,
    stability: updated.memory.stability,
    lapses: updated.memory.lapses,
  };
}
