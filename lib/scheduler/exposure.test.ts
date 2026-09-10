import { describe, expect, it } from "vitest";
import { emptyModalityStats, newMemoryState, type Atom, type Encounter } from "@/lib/atoms/types";
import { applyExposure, FRAGILE_TAPS, UNTAPPED_BUMP, UNTAPPED_CAP } from "./exposure";

const T0 = "2026-09-01T09:00:00.000Z";
const at = (days: number) => new Date(new Date(T0).getTime() + days * 86_400_000).toISOString();

function knownAtom(): Atom {
  return {
    id: "a",
    lang: "fr",
    type: "word",
    key: "marché",
    forms: ["marché"],
    gloss: "market",
    domains: [],
    relatedAtoms: [],
    memory: { ...newMemoryState(T0), status: "review", stability: 10, scheduledDays: 10, due: at(10), lastReview: T0, reps: 3 },
    modality: emptyModalityStats(),
    createdAt: at(-30),
    source: "frequency",
  };
}

const enc = (tapped: boolean, when: string, atomId = "a"): Encounter => ({ atomId, sentenceId: "s", passageId: "p", at: when, tapped });

describe("applyExposure", () => {
  it("bumps stability a little for untapped encounters, capped, without moving due", () => {
    const a = knownAtom();
    const one = applyExposure(a, [enc(false, at(1))], at(2));
    expect(one.atom.memory.stability).toBeCloseTo(10 * (1 + UNTAPPED_BUMP));
    expect(one.atom.memory.due).toBe(a.memory.due);
    expect(one.fragile).toBe(false);

    const many = applyExposure(a, Array.from({ length: 20 }, (_, i) => enc(false, at(1 + i / 100))), at(2));
    expect(many.atom.memory.stability).toBeCloseTo(10 * (1 + UNTAPPED_CAP));
    // Re-applying on the bumped atom does not compound.
    const again = applyExposure(many.atom, Array.from({ length: 20 }, (_, i) => enc(false, at(1 + i / 100))), at(3));
    expect(again.atom.memory.stability).toBeCloseTo(10 * (1 + UNTAPPED_CAP));
  });

  it("ignores encounters before the last review, for other atoms, or in the future", () => {
    const a = knownAtom();
    const r = applyExposure(a, [enc(false, at(-1)), enc(false, at(1), "b"), enc(false, at(5))], at(2));
    expect(r.atom).toBe(a);
  });

  it("flags a word tapped 3+ times in 7 days as fragile and pulls it due now", () => {
    const a = knownAtom();
    const taps = Array.from({ length: FRAGILE_TAPS }, (_, i) => enc(true, at(1 + i)));
    const r = applyExposure(a, taps, at(4));
    expect(r.fragile).toBe(true);
    expect(r.atom.memory.due).toBe(at(4));
    expect(r.atom.memory.stability).toBe(10);
    // Two taps are not enough; old taps fall out of the window.
    expect(applyExposure(a, taps.slice(0, 2), at(4)).fragile).toBe(false);
    expect(applyExposure(a, taps, at(12)).fragile).toBe(false);
  });

  it("leaves new and suspended atoms alone", () => {
    const a = { ...knownAtom(), memory: { ...newMemoryState(T0) } };
    expect(applyExposure(a, [enc(false, at(1))], at(2)).atom).toBe(a);
  });
});
