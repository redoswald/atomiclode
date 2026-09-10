import { describe, expect, it } from "vitest";
import freq from "@/db/seed/frequency-fr.json";
import chunks from "@/db/seed/chunks-fr.json";
import grammar from "@/db/seed/grammar-fr.json";
import {
  chunkLinks,
  chunksToRows,
  frequencyToRows,
  grammarToRows,
  validateSeed,
  type ChunkEntry,
  type FrequencyEntry,
  type GrammarEntry,
} from "./seed";

const FREQ = freq as FrequencyEntry[];
const CHUNKS = chunks as ChunkEntry[];
const GRAMMAR = grammar as GrammarEntry[];

describe("seed files", () => {
  it("are internally consistent", () => {
    expect(validateSeed(FREQ, CHUNKS, GRAMMAR)).toEqual([]);
  });

  it("have the expected sizes", () => {
    expect(FREQ.length).toBe(3000);
    expect(CHUNKS.length).toBeGreaterThan(30);
    expect(GRAMMAR.length).toBeGreaterThan(30);
  });

  it("every chunk word is in the frequency list", () => {
    const lemmas = new Set(FREQ.map((f) => f.lemma));
    const missing = CHUNKS.flatMap((c) => c.words.filter((w) => !lemmas.has(w)).map((w) => `${c.key}: ${w}`));
    expect(missing).toEqual([]);
  });
});

describe("row builders", () => {
  it("frequency entries become new word atoms with the lemma as a form", () => {
    const rows = frequencyToRows([
      { rank: 1, lemma: "vouloir", pos: "VERB", gender: null, forms: ["voudrais", "veux"], freqPerMillion: 100, gloss: "to want" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "word",
      key: "vouloir",
      forms: ["vouloir", "voudrais", "veux"],
      gloss: "to want",
      frequencyRank: 1,
      source: "frequency",
      status: "new",
    });
  });

  it("chunks and grammar keep their explanations and links", () => {
    const c = chunksToRows([{ key: "je voudrais", gloss: "I would like", words: ["je", "vouloir", "je"], grammar: ["x"] }]);
    expect(c[0]).toMatchObject({ type: "chunk", key: "je voudrais", forms: ["je voudrais"] });
    const g = grammarToRows([{ key: "x", gloss: "X", explanation: "Because." }]);
    expect(g[0]).toMatchObject({ type: "grammar", key: "x", explanation: "Because." });
    expect(chunkLinks([{ key: "je voudrais", gloss: "", words: ["je", "vouloir", "je"], grammar: ["x"] }]).get("je voudrais")).toEqual({
      words: ["je", "vouloir"],
      grammar: ["x"],
    });
  });

  it("validateSeed reports problems", () => {
    const problems = validateSeed(
      [{ rank: 2, lemma: "a", pos: "NOUN", gender: "m", forms: [], freqPerMillion: 1, gloss: "" }],
      [{ key: "c", gloss: "", words: [], grammar: ["nope"] }],
      [],
    );
    expect(problems).toContain('chunk "c" references unknown grammar "nope"');
    expect(problems.some((p) => p.startsWith("rank out of order"))).toBe(true);
  });
});
