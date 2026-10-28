/**
 * The Greek track: accent- and case-insensitive matching (ΕΞΟΔΟΣ is έξοδος),
 * the curriculum files validating against each other, a session built from
 * them in in-memory Postgres, and Latin-letter answers accepted.
 */
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { atoms, passages, scenarios } from "@/db/schema";
import chunksEl from "@/db/seed/chunks-el.json";
import grammarEl from "@/db/seed/grammar-el.json";
import scenariosEl from "@/db/seed/scenarios-el.json";
import wordsEl from "@/db/seed/words-el.json";
import { seedAtoms } from "@/db/seed/run";
import { seedScenarios } from "@/db/seed/scenarios";
import { validateSeed, type ChunkEntry, type GrammarEntry, type WordEntry } from "@/lib/atoms/seed";
import { homeCounts } from "@/lib/atoms/stats";
import { vocabStats } from "@/lib/atoms/vocab-stats";
import { normalizeEl } from "@/lib/lang";
import { buildLexicon } from "@/lib/reader/lexicon";
import { createPassage, listPassages, openPassage } from "@/lib/reader/passages";
import { analyzeLocal } from "@/lib/reader/tokenize";
import { lenientMatch } from "@/lib/review/match";
import { buildSession } from "@/lib/review/session";
import { validateScenarios, type ScenarioEntry } from "@/lib/scenarios/seed";
import { scenarioStates } from "@/lib/scenarios/visits";

const words = wordsEl as WordEntry[];
const chunks = chunksEl as ChunkEntry[];
const grammar = grammarEl as GrammarEntry[];
const scenes = scenariosEl as ScenarioEntry[];
const lexicon = buildLexicon("el", [...words.map((w) => ({ key: w.lemma, forms: w.forms })), ...chunks.map((c) => ({ key: c.key, forms: [] }))], normalizeEl);

describe("Greek normalization and tokenizing", () => {
  it("folds accents, case and the final sigma", () => {
    expect(normalizeEl("ΕΞΟΔΟΣ")).toBe(normalizeEl("έξοδος"));
    expect(normalizeEl("Ευχαριστώ")).toBe("ευχαριστω");
  });

  it("reads a sign in capitals as the word it is, and the article Η as a word", () => {
    const a = analyzeLocal("ΕΞΟΔΟΣ ΚΙΝΔΥΝΟΥ. Η έξοδος είναι δεξιά.", { lang: "el", lexicon });
    const w = a.tokens.filter((t) => t.isWord);
    expect(w.map((t) => t.surface)).toEqual(["ΕΞΟΔΟΣ", "ΚΙΝΔΥΝΟΥ", "Η", "έξοδος", "είναι", "δεξιά"]);
    expect(w[0].lemma).toBe(normalizeEl("έξοδος"));
    expect(w[3].lemma).toBe(normalizeEl("έξοδος"));
    expect(w[2].lemma).toBe("ο"); // the article, not the letter η
    expect(a.sentences).toHaveLength(2);
  });

  it("splits on the Greek question mark and keeps names", () => {
    const a = analyzeLocal("Πού είναι η Μαρία; Στη Νάξο.", { lang: "el", lexicon });
    expect(a.sentences).toEqual(["Πού είναι η Μαρία;", "Στη Νάξο."]);
    const maria = a.tokens.find((t) => t.surface === "Μαρία");
    expect(maria?.isWord).toBe(false);
  });
});

describe("Greek curriculum files", () => {
  it("validate as a seed", () => {
    expect(validateSeed(words, chunks, grammar)).toEqual([]);
  });

  it("have a gloss and a romanization on every entry, and signs in capitals", () => {
    for (const w of words) {
      expect(w.gloss, w.lemma).not.toBe("");
      expect(w.romanization, w.lemma).toBeTruthy();
      if (w.domains?.includes("signs")) expect(w.forms.some((f) => f === f.toUpperCase() && f !== f.toLowerCase()), w.lemma).toBe(true);
    }
    for (const c of chunks) expect(c.romanization, c.key).toBeTruthy();
    expect(words.filter((w) => w.pos === "LETTER").length).toBeGreaterThanOrEqual(24);
    expect(words.filter((w) => w.domains?.includes("signs")).length).toBeGreaterThanOrEqual(40);
    expect(chunks.length).toBeGreaterThanOrEqual(60);
  });

  it("scenarios use only bundle entries that appear in their dialogue", () => {
    expect(validateScenarios(scenes, new Set(grammar.map((g) => g.key)), { lang: "el", lexicon })).toEqual([]);
    expect(scenes.length).toBeGreaterThanOrEqual(8);
  });
});

describe("Greek answers", () => {
  it("accept Greek with or without accents, and Latin letters against the romanization", () => {
    expect(lenientMatch("ευχαριστω", ["ευχαριστώ"], { lang: "el" })).toBe(true);
    expect(lenientMatch("η έξοδος", ["έξοδος"], { lang: "el" })).toBe(true);
    expect(lenientMatch("ΕΞΟΔΟΣ", ["έξοδος"], { lang: "el" })).toBe(true);
    expect(lenientMatch("efcharisto", ["ευχαριστώ"], { lang: "el", romanizations: ["efcharistó"] })).toBe(true);
    expect(lenientMatch("efharisto", ["ευχαριστώ"], { lang: "el", romanizations: ["efcharistó / efharistó"] })).toBe(true);
    expect(lenientMatch("parakalo", ["ευχαριστώ"], { lang: "el", romanizations: ["efcharistó"] })).toBe(false);
    expect(lenientMatch("merci", ["ευχαριστώ"], { lang: "el" })).toBe(false);
  });
});

describe("Greek track in the database", () => {
  let client: PGlite;
  let d: ReturnType<typeof drizzle<typeof schema>>;
  const NOW = new Date("2026-10-28T09:00:00Z");

  beforeAll(async () => {
    client = new PGlite();
    d = drizzle(client, { schema });
    await migrate(d, { migrationsFolder: "./drizzle" });
    await seedAtoms(d, { freq: words, chunks, grammar }, "el");
    await seedScenarios(d, scenes, "el", NOW);
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  it("seeds every Greek atom with its gloss, gender and romanization, apart from French", async () => {
    const rows = await d.select().from(atoms).where(eq(atoms.lang, "el"));
    expect(rows.length).toBe(words.length + chunks.length + grammar.length);
    const exodos = rows.find((r) => r.key === "έξοδος");
    expect(exodos).toMatchObject({ gender: "f", romanization: "éxodos", receptiveOnly: true });
    expect(exodos!.forms).toContain("ΕΞΟΔΟΣ");
    expect(await d.select().from(atoms).where(eq(atoms.lang, "fr"))).toHaveLength(0);
    const counts = await homeCounts(NOW, d, "el");
    expect(counts.unglossed).toBe(0);
    expect((await homeCounts(NOW, d, "fr")).total).toBe(0);
  });

  it("seeds the scenes with Greek dialogue passages", async () => {
    const states = await scenarioStates(d, "el");
    expect(states.length).toBe(scenes.length);
    expect(await scenarioStates(d, "fr")).toHaveLength(0);
    const taxi = states.find((s) => s.scenario.slug === "el-taxi");
    expect(taxi?.latest).toBeDefined();
    const view = await openPassage(d, taxi!.latest!.visit.passageId!, NOW);
    expect(view?.lang).toBe("el");
    expect(view!.wordCount).toBeGreaterThan(30);
    // Nothing is known yet, but nearly every word of the dialogue is in the curriculum.
    const wordsOfView = view!.tokens.filter((t) => t.isWord);
    expect(wordsOfView.filter((t) => t.atomId).length / wordsOfView.length).toBeGreaterThan(0.9);
    const rows = await d.select({ lang: scenarios.lang }).from(scenarios);
    expect(rows.every((r) => r.lang === "el")).toBe(true);
  });

  it("builds a session that starts with the alphabet and shows signs receptively", async () => {
    const session = await buildSession(d, "steady", NOW, { lang: "el" });
    expect(session.cards.length).toBeGreaterThan(0);
    expect(session.cards.every((c) => c.lang === "el")).toBe(true);
    const first = session.cards.find((c) => c.reason === "new");
    expect(first?.pos).toBe("LETTER");
    expect(first?.modality).toBe("recognize");
    expect(first?.romanization).toBeTruthy();
    expect(await buildSession(d, "steady", NOW, { lang: "fr" })).toMatchObject({ cards: [] });
  });

  it("reads a sign in capitals against the curriculum and keeps the passage on the Greek track", async () => {
    const { id } = await createPassage(d, { lang: "el", title: "Στο λιμάνι", text: "ΕΙΣΟΔΟΣ — ΕΞΟΔΟΣ. ΑΠΑΓΟΡΕΥΕΤΑΙ ΤΟ ΠΑΡΚΙΝΓΚ.", origin: "imported" });
    const view = await openPassage(d, id, NOW);
    const exodos = view!.tokens.find((t) => t.surface === "ΕΞΟΔΟΣ");
    expect(exodos?.atomId).toBeTruthy();
    expect(exodos?.gloss).toBe("exit");
    expect(exodos?.romanization).toBe("éxodos");
    const [row] = await d.select({ lang: passages.lang }).from(passages).where(eq(passages.id, id));
    expect(row.lang).toBe("el");
    expect((await listPassages(d, "el")).some((p) => p.id === id)).toBe(true);
    expect(await listPassages(d, "fr")).toHaveLength(0);
    const parking = view!.tokens.find((t) => t.surface === "ΠΑΡΚΙΝΓΚ");
    expect(parking?.gloss).toBe("parking");
    expect(view!.tokens.find((t) => t.surface === "ΤΟ")?.atomId).toBeTruthy();
    const stats = await vocabStats(d, NOW, "el");
    expect(stats.corpusCoverage).toBe(0);
    const [grammarAtom] = await d.select().from(atoms).where(and(eq(atoms.lang, "el"), eq(atoms.key, "alphabet-and-sounds")));
    expect(grammarAtom).toBeDefined();
  });
});
