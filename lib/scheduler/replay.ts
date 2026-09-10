import type { Atom, MemoryState, ReviewEvent } from "@/lib/atoms/types";
import { emptyModalityStats, newMemoryState } from "@/lib/atoms/types";
import { applyReview } from "./applyReview";

/** Stability given to an atom the learner marked "Already know" (SPEC §5). */
export const KNOWN_STABILITY_DAYS = 120;

/** Memory state for an atom marked as already known at `at`. */
export function knownMemoryState(at: string): MemoryState {
  const t = new Date(at).getTime();
  return {
    stability: KNOWN_STABILITY_DAYS,
    difficulty: 3,
    due: new Date(t + KNOWN_STABILITY_DAYS * 86_400_000).toISOString(),
    lastReview: at,
    reps: 1,
    lapses: 0,
    status: "review",
    learningSteps: 0,
    scheduledDays: KNOWN_STABILITY_DAYS,
  };
}

/**
 * Memory state is a cache of the review log. Rebuild it from scratch for every
 * atom by replaying events in time order. Atoms without events reset to `new`
 * (due at creation). Suspension is recomputed from lapses, so a manually
 * suspended atom with fewer than LEECH_LAPSES lapses becomes active again.
 */
export function replay(atoms: Atom[], events: ReviewEvent[]): Atom[] {
  const byAtom = new Map<string, Atom>();
  for (const a of atoms) {
    const memory = a.markedKnownAt ? knownMemoryState(a.markedKnownAt) : newMemoryState(a.createdAt);
    byAtom.set(a.id, { ...a, memory, modality: emptyModalityStats() });
  }
  const ordered = [...events].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  for (const e of ordered) {
    const atom = byAtom.get(e.atomId);
    if (!atom) continue; // event for a deleted atom
    byAtom.set(e.atomId, applyReview(atom, e));
  }
  return atoms.map((a) => byAtom.get(a.id)!);
}
