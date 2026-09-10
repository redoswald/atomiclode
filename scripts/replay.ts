/**
 * Rebuild every atom's memory state from the review log. Run after changing
 * the scheduler so cached state matches what the new rules would have produced.
 *
 *   npm run db:replay
 */
import "dotenv/config";
import { asc, eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { atoms, reviewEvents } from "@/db/schema";
import { atomToRow, rowToAtom } from "@/lib/atoms/rows";
import type { Grade } from "@/lib/atoms/types";
import { replay } from "@/lib/scheduler";

async function main() {
  if (!hasDatabase()) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const d = db();
  const rows = await d.select().from(atoms);
  const events = await d.select().from(reviewEvents).orderBy(asc(reviewEvents.at), asc(reviewEvents.id));
  const rebuilt = replay(
    rows.map(rowToAtom),
    events.map((e) => ({
      atomId: e.atomId,
      modality: e.modality,
      sentenceId: e.sentenceId ?? undefined,
      grade: e.grade as Grade,
      responseMs: e.responseMs,
      at: e.at,
    })),
  );
  let changed = 0;
  for (let i = 0; i < rows.length; i++) {
    const before = rowToAtom(rows[i]);
    const after = rebuilt[i];
    if (JSON.stringify(before.memory) === JSON.stringify(after.memory) && JSON.stringify(before.modality) === JSON.stringify(after.modality)) continue;
    const next = atomToRow(after);
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
      .where(eq(atoms.id, after.id));
    changed++;
  }
  console.log(`replayed ${events.length} events over ${rows.length} atoms; ${changed} updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
