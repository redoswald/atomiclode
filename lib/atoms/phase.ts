/**
 * Foundation or reading (SPEC §4). Derived from what the learner knows, never a
 * setting: below the threshold new atoms come mainly from scenarios, above it
 * from the goal text and mining. Crossing it changes an ordering, nothing else.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms } from "@/db/schema";
import { corpusCoverageOf } from "./vocab-stats";

export type Phase = "foundation" | "reading";

/** Share of running French text covered by known words at which reading takes over. A guess; tune it. */
export const READING_THRESHOLD = 0.8;

export function phaseFor(corpusCoverage: number): Phase {
  return corpusCoverage >= READING_THRESHOLD ? "reading" : "foundation";
}

export async function currentPhase(d: Db): Promise<{ phase: Phase; corpusCoverage: number; knownWords: number }> {
  const rows = await d
    .select({ key: atoms.key })
    .from(atoms)
    .where(and(eq(atoms.type, "word"), inArray(atoms.status, ["learning", "review"])));
  const corpusCoverage = corpusCoverageOf(rows.map((r) => r.key));
  return { phase: phaseFor(corpusCoverage), corpusCoverage, knownWords: rows.length };
}
