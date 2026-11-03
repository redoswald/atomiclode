import { and, eq, max } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, reviewEvents } from "@/db/schema";
import { atomToRow, rowToAtom } from "@/lib/atoms/rows";
import type { Grade, Modality } from "@/lib/atoms/types";
import { MODALITIES } from "@/lib/atoms/types";
import { applyReview } from "@/lib/scheduler";
import { rebuildAtom } from "./rebuild";

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

/** Append to the review log, then update the atom's cached memory state. Only the owner's atoms. */
export async function recordReview(d: Db, userId: string, input: RecordReviewInput, now = new Date()): Promise<RecordReviewResult> {
  if (![1, 2, 3, 4].includes(input.grade)) throw new Error("grade must be 1–4");
  if (!MODALITIES.includes(input.modality)) throw new Error("unknown modality");
  const at = now.toISOString();

  const mine = and(eq(atoms.id, input.atomId), eq(atoms.userId, userId));
  const [row] = await d.select().from(atoms).where(mine);
  if (!row) throw new Error("unknown atom");
  // An answer older than the atom's latest event (given offline, arriving late) is
  // inserted at its own time and the atom rebuilt from its log (SPEC §19 rule 2).
  const [latest] = await d.select({ at: max(reviewEvents.at) }).from(reviewEvents).where(eq(reviewEvents.atomId, input.atomId));
  const late = latest?.at ? new Date(latest.at).getTime() > now.getTime() : false;

  await d.insert(reviewEvents).values({
    userId,
    atomId: input.atomId,
    modality: input.modality,
    sentenceId: input.sentenceId ?? null,
    grade: input.grade,
    responseMs: Math.max(0, Math.round(input.responseMs)),
    at,
  });

  if (late) {
    await rebuildAtom(d, userId, input.atomId);
    const [after] = await d.select().from(atoms).where(mine);
    return { status: after.status, due: new Date(after.due).toISOString(), stability: after.stability, lapses: after.lapses };
  }

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
    .where(mine);

  return {
    status: updated.memory.status,
    due: updated.memory.due,
    stability: updated.memory.stability,
    lapses: updated.memory.lapses,
  };
}
