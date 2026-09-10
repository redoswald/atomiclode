/**
 * Integration: import a passage into in-memory Postgres, read it, mine a word,
 * mark another as known, and see the cloze card appear in a review session.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { atoms, encounters, sentences } from "@/db/schema";
import chunks from "@/db/seed/chunks-fr.json";
import freq from "@/db/seed/frequency-fr.json";
import grammar from "@/db/seed/grammar-fr.json";
import { seedAtoms } from "@/db/seed/run";
import type { ChunkEntry, FrequencyEntry, GrammarEntry } from "@/lib/atoms/seed";
import { recordReview } from "@/lib/review/record";
import { buildSession, findGap } from "@/lib/review/session";
import { replay } from "@/lib/scheduler";
import { rowToAtom } from "@/lib/atoms/rows";
import { computeCoverage } from "./coverage";
import { cleanText, validateUrl } from "./import";
import { createPassage, listPassages, markKnown, mineWord, openPassage } from "./passages";

let client: PGlite;
let d: ReturnType<typeof drizzle<typeof schema>>;
const NOW = new Date("2026-09-10T12:00:00Z");
const TEXT =
  "Je voudrais un café, s'il vous plaît. Le marché du samedi est toujours bondé.\n\nHier, Marie achète des tomates et un scontrino inconnu.";

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  await seedAtoms(d, { freq: freq as FrequencyEntry[], chunks: chunks as ChunkEntry[], grammar: grammar as GrammarEntry[] });
  // Pretend a few words are learned so coverage is not zero.
  for (const key of ["le", "un", "être", "toujours", "et", "de"]) {
    await d.update(atoms).set({ status: "review", stability: 20, reps: 3 }).where(sql`${atoms.type} = 'word' and ${atoms.key} = ${key}`);
  }
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("reader", () => {
  let passageId: string;

  it("imports and analyses a passage", async () => {
    const { id, source } = await createPassage(d, { text: TEXT, origin: "imported", title: "Au marché" });
    passageId = id;
    expect(source).toBe("local");
    const [summary] = await listPassages(d);
    expect(summary).toMatchObject({ id, title: "Au marché", origin: "imported", reads: 0 });
    expect(summary.wordCount).toBeGreaterThan(15);
  });

  it("opens with live coverage, chunk matches, names excluded, and logs encounters", async () => {
    const view = (await openPassage(d, passageId, NOW))!;
    expect(view.reads).toBe(1);
    expect(view.sentences).toHaveLength(3);
    // The chunk atom "je voudrais un café" is not learned yet, so its words are unknown.
    const chunkTokens = view.tokens.filter((t) => t.chunkKey === "je voudrais un café");
    expect(chunkTokens.map((t) => t.surface)).toEqual(["Je", "voudrais", "un", "café"]);
    // "Marie" is a name: not a word, not counted.
    expect(view.tokens.find((t) => t.surface === "Marie")?.isWord).toBe(false);
    // Learned words are known; seeded-but-new words and unseeded words are not.
    const bySurface = (s: string) => view.tokens.find((t) => t.surface === s)!;
    expect(bySurface("toujours").known).toBe(true);
    expect(bySurface("marché").known).toBe(false);
    expect(bySurface("marché").atomId).toBeDefined();
    expect(bySurface("scontrino").known).toBe(false);
    expect(bySurface("scontrino").atomId).toBeUndefined();
    expect(view.coverage).toBeGreaterThan(0.2);
    expect(view.coverage).toBeLessThan(0.6);
    expect(view.unknownCount).toBeGreaterThan(5);
    const [{ n }] = await d.select({ n: sql<number>`count(*)::int` }).from(encounters);
    expect(n).toBeGreaterThan(0);
    // Text reproduces exactly.
    expect(view.tokens.map((t) => t.pre + t.surface).join("")).toBe(TEXT);
  });

  it("mines a word: links the seeded atom, saves the sentence with every atom in it", async () => {
    const view = (await openPassage(d, passageId, NOW))!;
    const marche = view.tokens.find((t) => t.surface === "marché")!;
    const { atomId, sentenceId } = await mineWord(
      d,
      { passageId, sentenceIdx: marche.sentenceIdx, lemma: marche.lemma, surface: marche.surface, gloss: "market" },
      NOW,
    );
    expect(atomId).toBe(marche.atomId);
    const [atom] = await d.select().from(atoms).where(eq(atoms.id, atomId));
    expect(atom.source).toBe("mined"); // jumped the frequency queue
    expect(atom.status).toBe("new");
    const [sentence] = await d.select().from(sentences).where(eq(sentences.id, sentenceId));
    expect(sentence.text).toBe("Le marché du samedi est toujours bondé.");
    expect(sentence.origin).toBe("imported");
    expect(sentence.atomIds).toContain(atomId);
    expect(sentence.atomIds.length).toBeGreaterThan(3);

    // Mining a second word in the same sentence reuses the sentence row.
    const bonde = view.tokens.find((t) => t.surface === "bondé")!;
    const second = await mineWord(d, { passageId, sentenceIdx: bonde.sentenceIdx, lemma: bonde.lemma, surface: "bondé", gloss: "packed" }, NOW);
    expect(second.sentenceId).toBe(sentenceId);
  });

  it("creates an atom for an unseeded word and 'already know' makes it mature", async () => {
    const view = (await openPassage(d, passageId, NOW))!;
    const tok = view.tokens.find((t) => t.surface === "scontrino")!;
    const { atomId } = await markKnown(d, { lemma: tok.lemma, surface: tok.surface, gloss: "receipt" }, NOW);
    const [atom] = await d.select().from(atoms).where(eq(atoms.id, atomId));
    expect(atom).toMatchObject({ type: "word", key: "scontrino", gloss: "receipt", source: "manual", status: "review" });
    expect(atom.stability).toBeGreaterThan(30);
    expect(atom.markedKnownAt).not.toBeNull();
    // Replay from an empty log keeps it known.
    const [replayed] = replay([rowToAtom(atom)], []);
    expect(replayed.memory.status).toBe("review");

    const again = (await openPassage(d, passageId, NOW))!;
    expect(again.tokens.find((t) => t.surface === "scontrino")?.known).toBe(true);
  });

  it("mined atoms come first as new cards, then get cloze cards from the saved sentence", async () => {
    const first = await buildSession(d, "steady", NOW);
    const newKeys = first.cards.filter((c) => c.reason === "new").map((c) => c.key);
    expect(newKeys.slice(0, 2).sort()).toEqual(["bonder", "marché"]); // bondé lemmatizes to bonder

    // Learn "marché" through recognize, recall, recognize; then the next due review should be a cloze.
    const marche = first.cards.find((c) => c.key === "marché")!;
    let t = NOW.getTime();
    const [row0] = await d.select().from(atoms).where(eq(atoms.id, marche.atomId));
    let due = new Date(row0.due).getTime();
    for (const modality of ["recognize", "recall", "recognize", "recall"] as const) {
      t = Math.max(t + 60_000, due);
      await recordReview(d, { atomId: marche.atomId, modality, grade: 3, responseMs: 2000 }, new Date(t));
      const [row] = await d.select().from(atoms).where(eq(atoms.id, marche.atomId));
      due = new Date(row.due).getTime();
    }
    const later = new Date(due + 1000);
    const session = await buildSession(d, "steady", later);
    const card = session.cards.find((c) => c.atomId === marche.atomId);
    expect(card?.modality).toBe("cloze");
    expect(card?.cloze).toEqual({ before: "Le ", answer: "marché", after: " du samedi est toujours bondé." });
  }, 60_000);
});

describe("helpers", () => {
  it("findGap is accent- and case-insensitive and whole-word", () => {
    expect(findGap("Le MARCHE est là.", ["marché"])).toEqual({ before: "Le ", answer: "MARCHE", after: " est là." });
    expect(findGap("Il a marché.", ["marcher", "marché"])).toEqual({ before: "Il a ", answer: "marché", after: "." });
    expect(findGap("Les marchés ferment.", ["marché"])).toBeUndefined();
    expect(findGap("Les marchés ferment.", ["marché", "marchés"])).toEqual({ before: "Les ", answer: "marchés", after: " ferment." });
  });

  it("computeCoverage counts chunks as one known unit per token", () => {
    const tokens = [
      { pre: "", surface: "il", lemma: "il", isWord: true, sentenceIdx: 0, chunkKey: "il y a" },
      { pre: " ", surface: "y", lemma: "y", isWord: true, sentenceIdx: 0, chunkKey: "il y a" },
      { pre: " ", surface: "a", lemma: "avoir", isWord: true, sentenceIdx: 0, chunkKey: "il y a" },
      { pre: " ", surface: "trop", lemma: "trop", isWord: true, sentenceIdx: 0 },
      { pre: "", surface: ".", lemma: "", isWord: false, sentenceIdx: 0 },
    ];
    const r = computeCoverage(
      tokens,
      () => undefined,
      (k) => (k === "il y a" ? { id: "c", key: k, status: "review", gloss: "" } : undefined),
    );
    expect(r).toMatchObject({ wordCount: 4, knownCount: 3, unknownLemmas: ["trop"], knownAtomIds: ["c"] });
    expect(r.coverage).toBeCloseTo(0.75);
  });

  it("validateUrl blocks private addresses and non-http schemes", () => {
    expect(() => validateUrl("ftp://example.com")).toThrow();
    expect(() => validateUrl("http://localhost:3000/x")).toThrow();
    expect(() => validateUrl("http://192.168.1.1/")).toThrow();
    expect(() => validateUrl("not a url")).toThrow();
    expect(validateUrl(" https://www.lemonde.fr/x ").hostname).toBe("www.lemonde.fr");
  });

  it("cleanText keeps paragraphs and drops empty lines", () => {
    expect(cleanText("  Un.  \n\n\n  Deux   trois.\n\n")).toBe("Un.\n\nDeux trois.");
  });
});
