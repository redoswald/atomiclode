import { and, count, lte, min, sql } from "drizzle-orm";
import { db, type Db } from "@/db";
import { atoms, reviewEvents } from "@/db/schema";
import type { AtomType, MemoryStatus } from "./types";

export interface HomeCounts {
  /** Days since the first review, starting at 1. */
  day: number;
  total: number;
  byStatus: Record<MemoryStatus, number>;
  byType: Record<AtomType, number>;
  /** Atoms in learning/review whose due date has passed. */
  dueNow: number;
  /** New atoms available to introduce (never reviewed, not suspended). */
  newAvailable: { word: number; chunk: number; grammar: number };
  reviewsTotal: number;
  /** Word atoms with an empty gloss; they can't be introduced until filled. */
  unglossed: number;
}

export async function homeCounts(now = new Date(), d: Db = db()): Promise<HomeCounts> {
  const nowIso = now.toISOString();

  const [statusRows, typeRows, dueRows, newRows, reviewRows, unglossedRows] = await Promise.all([
    d.select({ status: atoms.status, n: count() }).from(atoms).groupBy(atoms.status),
    d.select({ type: atoms.type, n: count() }).from(atoms).groupBy(atoms.type),
    d
      .select({ n: count() })
      .from(atoms)
      .where(and(sql`${atoms.status} in ('learning', 'review')`, lte(atoms.due, nowIso))),
    d
      .select({ type: atoms.type, n: count() })
      .from(atoms)
      .where(sql`${atoms.status} = 'new'`)
      .groupBy(atoms.type),
    d.select({ n: count(), first: min(reviewEvents.at) }).from(reviewEvents),
    d
      .select({ n: count() })
      .from(atoms)
      .where(sql`${atoms.type} = 'word' and ${atoms.gloss} = ''`),
  ]);

  const byStatus: Record<MemoryStatus, number> = { new: 0, learning: 0, review: 0, suspended: 0 };
  for (const r of statusRows) byStatus[r.status] = r.n;
  const byType: Record<AtomType, number> = { word: 0, chunk: 0, grammar: 0 };
  for (const r of typeRows) byType[r.type] = r.n;
  const newAvailable = { word: 0, chunk: 0, grammar: 0 };
  for (const r of newRows) newAvailable[r.type] = r.n;

  const first = reviewRows[0]?.first;
  const day = first ? Math.floor((now.getTime() - new Date(first).getTime()) / 86_400_000) + 1 : 1;

  return {
    day,
    total: byStatus.new + byStatus.learning + byStatus.review + byStatus.suspended,
    byStatus,
    byType,
    dueNow: dueRows[0]?.n ?? 0,
    newAvailable,
    reviewsTotal: reviewRows[0]?.n ?? 0,
    unglossed: unglossedRows[0]?.n ?? 0,
  };
}
