import type { Atom, ReviewEvent } from "@/lib/atoms/types";
import { emptyModalityStats, newMemoryState } from "@/lib/atoms/types";
import { applyReview } from "./applyReview";

/**
 * Memory state is a cache of the review log. Rebuild it from scratch for every
 * atom by replaying events in time order. Atoms without events reset to `new`
 * (due at creation). Suspension is recomputed from lapses, so a manually
 * suspended atom with fewer than LEECH_LAPSES lapses becomes active again.
 */
export function replay(atoms: Atom[], events: ReviewEvent[]): Atom[] {
  const byAtom = new Map<string, Atom>();
  for (const a of atoms) {
    byAtom.set(a.id, { ...a, memory: newMemoryState(a.createdAt), modality: emptyModalityStats() });
  }
  const ordered = [...events].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  for (const e of ordered) {
    const atom = byAtom.get(e.atomId);
    if (!atom) continue; // event for a deleted atom
    byAtom.set(e.atomId, applyReview(atom, e));
  }
  return atoms.map((a) => byAtom.get(a.id)!);
}
