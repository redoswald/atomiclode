/**
 * Rebuild one atom's memory state from its log (SPEC §19 rule 2): its reviews in
 * time order, its encounters and its introduction. Used when an answer arrives
 * older than the atom's latest event, as answers given offline do.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, encounters, introductions, reviewEvents } from "@/db/schema";
import { atomToRow, rowToAtom } from "@/lib/atoms/rows";
import type { Grade } from "@/lib/atoms/types";
import { replay } from "@/lib/scheduler";

export async function rebuildAtom(d: Db, userId: string, atomId: string): Promise<void> {
  const mine = and(eq(atoms.id, atomId), eq(atoms.userId, userId));
  const [row] = await d.select().from(atoms).where(mine);
  if (!row) return;
  const [events, seen, intro] = await Promise.all([
    d.select().from(reviewEvents).where(eq(reviewEvents.atomId, atomId)).orderBy(asc(reviewEvents.at), asc(reviewEvents.id)),
    d.select().from(encounters).where(eq(encounters.atomId, atomId)),
    d.select().from(introductions).where(eq(introductions.atomId, atomId)),
  ]);
  const [rebuilt] = replay(
    [rowToAtom(row)],
    events.map((e) => ({ atomId, modality: e.modality, sentenceId: e.sentenceId ?? undefined, grade: e.grade as Grade, responseMs: e.responseMs, at: new Date(e.at).toISOString() })),
    seen.map((e) => ({ atomId, sentenceId: e.sentenceId ?? "", passageId: e.passageId ?? "", at: new Date(e.at).toISOString(), tapped: e.tapped })),
    intro.map((i) => ({ atomId, at: i.at, due: i.due, firstTimeRight: i.firstTimeRight })),
  );
  const next = atomToRow(rebuilt);
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
}
