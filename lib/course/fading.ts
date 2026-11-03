/**
 * Lessons fade, nothing is taken away (SPEC §17 Pacing): a finished lesson
 * whose introduced words are mostly overdue or lapsing shows as faded on the
 * path and offers Refresh, a short practice on just those words that counts as
 * reviewing them.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, introductions } from "@/db/schema";
import type { Learner } from "@/lib/learners/provision";

const DAY_MS = 86_400_000;
/** A lesson fades once at least this share of its words are slipping. */
export const FADE_SHARE = 0.5;

export interface SlippingAtom {
  status: string;
  due: string;
  lapses: number;
}

/** Overdue by more than a day, suspended, or forgotten twice and back in relearning. */
export function slipping(a: SlippingAtom, now = new Date()): boolean {
  if (a.status === "suspended") return true;
  if (a.status === "learning" && a.lapses >= 2) return true;
  return a.status !== "new" && new Date(a.due).getTime() < now.getTime() - DAY_MS;
}

/** Faded lessons, each with the atom ids that are slipping. */
export async function fadedLessons(d: Db, me: Learner, now = new Date()): Promise<Map<string, string[]>> {
  const rows = await d
    .select({ lessonId: introductions.lessonId, atomId: atoms.id, status: atoms.status, due: atoms.due, lapses: atoms.lapses })
    .from(introductions)
    .innerJoin(atoms, eq(atoms.id, introductions.atomId))
    .where(and(eq(introductions.userId, me.userId), eq(atoms.userId, me.userId), eq(atoms.lang, me.lang)));
  const byLesson = new Map<string, { total: number; slip: string[] }>();
  for (const r of rows) {
    const e = byLesson.get(r.lessonId) ?? { total: 0, slip: [] };
    e.total++;
    if (slipping(r, now)) e.slip.push(r.atomId);
    byLesson.set(r.lessonId, e);
  }
  const out = new Map<string, string[]>();
  for (const [id, e] of byLesson) if (e.total >= 2 && e.slip.length / e.total >= FADE_SHARE) out.set(id, e.slip);
  return out;
}
