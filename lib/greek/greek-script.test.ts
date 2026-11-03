/**
 * Greek script (SPEC §16): units, lookalikes, the letter-and-word plan, and the
 * decode card in the scheduler. Pure; the seed files are the real curriculum.
 */
import { describe, expect, it } from "vitest";
import chunksEl from "@/db/seed/chunks-el.json";
import wordsEl from "@/db/seed/words-el.json";
import { emptyModalityStats, newMemoryState, type Atom } from "@/lib/atoms/types";
import { chooseModality, decodable, planSession } from "@/lib/scheduler/planSession";
import { LETTER_SAY } from "@/lib/speech/say";
import { planScript, type ScriptAtom } from "./plan";
import { COMBINATIONS, letterKey, lookalikeMisread, scriptUnits } from "./script";

describe("script units", () => {
  it("reads combinations first, accents off, final sigma as σ", () => {
    expect(scriptUnits("τουαλέτα")).toEqual(["τ", "ου", "α", "λ", "ε", "τ", "α"]);
    expect(scriptUnits("ΦΑΡΜΑΚΕΙΟ")).toEqual(["φ", "α", "ρ", "μ", "α", "κ", "ει", "ο"]);
    expect(scriptUnits("καφές")).toEqual(["κ", "α", "φ", "ε", "σ"]);
    expect(scriptUnits("αγγλικά")).toEqual(["α", "γγ", "λ", "ι", "κ", "α"]);
    expect(scriptUnits("ευχαριστώ πολύ!")).toEqual(["ευ", "χ", "α", "ρ", "ι", "σ", "τ", "ω", "π", "ο", "λ", "υ"]);
  });

  it("lets a diaeresis split a combination", () => {
    expect(scriptUnits("λαϊκή")).toEqual(["λ", "α", "ι", "κ", "η"]);
    expect(scriptUnits("κοροϊδεύω")).toEqual(["κ", "ο", "ρ", "ο", "ι", "δ", "ευ", "ω"]);
  });

  it("has a letter atom and a spoken example for every unit", () => {
    const letters = new Set((wordsEl as Array<{ lemma: string }>).map((w) => w.lemma).filter((l) => l.startsWith("letter:")));
    for (const c of COMBINATIONS) {
      expect(letters.has(letterKey(c)), c).toBe(true);
      expect(LETTER_SAY[letterKey(c)], c).toBeTruthy();
    }
    for (const l of "αβγδεζηθικλμνξοπρστυφχψω") expect(letters.has(letterKey(l)), l).toBe(true);
  });

  it("names the lookalike that misled a decode answer", () => {
    expect(lookalikeMisread("ΜΕΤΡΟ", "metpo", "métro")).toMatchObject({ letter: "Ρ", says: "r" });
    expect(lookalikeMisread("ΜΕΤΡΟ", "metro", "métro")).toBeUndefined();
    expect(lookalikeMisread("νερό", "vero", "neró")).toMatchObject({ letter: "ν", says: "n" });
  });
});

// The real curriculum, as a brand-new learner has it.
const seedAtoms = (): ScriptAtom[] => [
  ...(wordsEl as Array<{ lemma: string; pos: string; domains?: string[]; rank: number; gloss: string }>).map((w) => ({
    id: w.lemma,
    key: w.lemma,
    type: "word" as const,
    status: "new" as const,
    pos: w.pos,
    domains: w.domains ?? [],
    frequencyRank: w.rank,
    gloss: w.gloss,
  })),
  ...(chunksEl as Array<{ key: string; gloss: string }>).map((c) => ({
    id: `chunk:${c.key}`,
    key: c.key,
    type: "chunk" as const,
    status: "new" as const,
    pos: null,
    domains: [],
    frequencyRank: null,
    gloss: c.gloss,
  })),
];

describe("planScript", () => {
  it("starts with a letter and never places a word before its letters", () => {
    const atoms = seedAtoms();
    const { order, blocked } = planScript(atoms);
    expect(order[0].startsWith("letter:")).toBe(true);
    const seen = new Set<string>();
    for (const id of order) {
      if (id.startsWith("letter:")) {
        seen.add(id.slice("letter:".length));
        continue;
      }
      for (const u of scriptUnits(atoms.find((a) => a.id === id)!.key)) expect(seen.has(u), `${id} before ${u}`).toBe(true);
    }
    // Letters come a few at a time, not as a block: fewer than half of the first 20 items.
    expect(order.slice(0, 20).filter((id) => id.startsWith("letter:")).length).toBeLessThan(10);
    // Whatever isn't planned waits.
    expect(blocked).toContain("φαρμακείο");
    expect(new Set([...order, ...blocked]).size).toBe(order.length + blocked.length);
  });

  it("serves words readable with known letters before new letters", () => {
    const atoms = seedAtoms().map((a) => (a.pos === "LETTER" && ["letter:κ", "letter:α", "letter:φ", "letter:ε", "letter:σ", "letter:τ", "letter:ξ", "letter:ι"].includes(a.id) ? { ...a, status: "review" as const } : a));
    const { order } = planScript(atoms);
    const firstLetter = order.findIndex((id) => id.startsWith("letter:"));
    expect(firstLetter).toBeGreaterThan(1);
    expect(order.slice(0, firstLetter)).toEqual(expect.arrayContaining(["καφές", "ταξί"]));
  });

  it("lets a scene word pull in every letter it needs", () => {
    const { order } = planScript(seedAtoms(), ["φαρμακείο"]);
    const at = order.indexOf("φαρμακείο");
    expect(at).toBeGreaterThan(0);
    expect(order.slice(0, at).sort()).toEqual(["letter:ει", "letter:κ", "letter:μ", "letter:ο", "letter:α", "letter:ρ", "letter:φ"].sort());
  });
});

function greek(over: Partial<Atom> = {}): Atom {
  return {
    id: over.id ?? "w",
    lang: "el",
    type: "word",
    key: "καφές",
    forms: ["καφές"],
    gloss: "coffee",
    romanization: "kafés",
    domains: [],
    relatedAtoms: [],
    memory: newMemoryState("2026-11-01T09:00:00.000Z"),
    modality: emptyModalityStats(),
    createdAt: "2026-11-01T09:00:00.000Z",
    source: "frequency",
    ...over,
  };
}

describe("decode cards", () => {
  it("are for Greek words and phrases, not letters, grammar or French", () => {
    expect(decodable(greek())).toBe(true);
    expect(decodable(greek({ pos: "LETTER", key: "letter:κ" }))).toBe(false);
    expect(decodable(greek({ type: "grammar" }))).toBe(false);
    expect(decodable(greek({ lang: "fr", romanization: undefined }))).toBe(false);
  });

  it("introduce a new Greek word, and skip blocked atoms", () => {
    const word = greek({ id: "kafes" });
    const locked = greek({ id: "farmakeio", key: "φαρμακείο", romanization: "farmakío" });
    const plan = planSession([word, locked], [], {
      now: "2026-11-01T09:00:00.000Z",
      timeBudgetMin: 12,
      newAtomsPerDay: 10,
      newAtomsIntroducedToday: 0,
      intensity: "steady",
      newOrder: ["kafes"],
      blockedNew: ["farmakeio"],
    });
    expect(plan.items).toEqual([{ atomId: "kafes", modality: "decode", reason: "new" }]);
  });

  it("alternate with recognize early, then return only while decoding is shaky", () => {
    const review = { ...newMemoryState("2026-11-01T09:00:00.000Z"), status: "review" as const, reps: 1, stability: 2 };
    const stats = emptyModalityStats();
    expect(chooseModality(greek({ memory: review, modality: stats }), false, "steady")).toBe("decode");
    const afterDecode = { ...stats, decode: { attempts: 1, correct: 1 } };
    expect(chooseModality(greek({ memory: review, modality: afterDecode }), false, "steady")).not.toBe("decode");
    const later = { ...review, reps: 6 };
    const shaky = { ...stats, decode: { attempts: 4, correct: 2 }, recognize: { attempts: 4, correct: 4 } };
    const solid = { ...stats, decode: { attempts: 4, correct: 4 }, recognize: { attempts: 4, correct: 4 } };
    expect(chooseModality(greek({ memory: later, modality: shaky }), false, "steady")).toBe("decode");
    expect(chooseModality(greek({ memory: later, modality: solid }), false, "steady")).not.toBe("decode");
    expect(chooseModality(greek({ memory: review, modality: stats }), false, "light")).toBe("recognize");
  });
});
