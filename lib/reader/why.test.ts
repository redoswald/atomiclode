/**
 * Integration (PGlite, no model): "why?" caching and grammar-atom birth, and
 * the passage library's reuse-before-generate decision, with fake model functions.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { atoms, passages } from "@/db/schema";
import chunks from "@/db/seed/chunks-fr.json";
import freq from "@/db/seed/frequency-fr.json";
import grammar from "@/db/seed/grammar-fr.json";
import { seedAtoms } from "@/db/seed/run";
import type { ChunkEntry, FrequencyEntry, GrammarEntry } from "@/lib/atoms/seed";
import type { WhyInput } from "@/lib/llm/why";
import { dueLemmas, findReusable, reuseOrGenerate, unreadGenerated } from "./library";
import { createPassage, openPassage } from "./passages";
import { addGrammarAtom, askWhy } from "./why";

let client: PGlite;
let d: ReturnType<typeof drizzle<typeof schema>>;
const NOW = new Date("2026-09-10T12:00:00Z");

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  await seedAtoms(d, { freq: freq as FrequencyEntry[], chunks: chunks as ChunkEntry[], grammar: grammar as GrammarEntry[] });
  // Learn the 60 most frequent words so generation has something to work with.
  await d
    .update(atoms)
    .set({ status: "review", stability: 30, reps: 3, due: "2026-09-01T00:00:00Z" })
    .where(sql`${atoms.type} = 'word' and ${atoms.frequencyRank} <= 60`);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("askWhy", () => {
  const fake = vi.fn(async (input: WhyInput) => ({
    explanation: `About ${input.atom.key}${input.sentence ? " in context" : ""}.`,
    grammar:
      input.atom.key === "vouloir"
        ? { key: "conditional-polite-request", title: "Conditional for polite requests", explanation: "", existing: true }
        : input.atom.key === "faille"
          ? { key: "subjunctive-after-il-faut", title: "Subjunctive after il faut", explanation: "Il faut que triggers the subjunctive.", existing: false }
          : undefined,
  }));

  it("caches generic explanations on the atom and links existing grammar", async () => {
    const [vouloir] = await d.select().from(atoms).where(sql`${atoms.type} = 'word' and ${atoms.key} = 'vouloir'`);
    const first = await askWhy(d, { atomId: vouloir.id }, fake);
    expect(first.cached).toBe(false);
    expect(first.explanation).toBe("About vouloir.");
    expect(first.grammar).toMatchObject({ key: "conditional-polite-request", existing: true });
    expect(fake).toHaveBeenCalledTimes(1);
    // The model was told which grammar concepts already exist.
    expect(fake.mock.calls[0][0].concepts.some((c) => c.key === "conditional-polite-request")).toBe(true);

    const [after] = await d.select().from(atoms).where(eq(atoms.id, vouloir.id));
    expect(after.explanation).toBe("About vouloir.");
    const [g] = await d.select().from(atoms).where(sql`${atoms.type} = 'grammar' and ${atoms.key} = 'conditional-polite-request'`);
    expect(after.relatedAtoms).toContain(g.id);

    const second = await askWhy(d, { atomId: vouloir.id }, fake);
    expect(second.cached).toBe(true);
    expect(second.grammar?.key).toBe("conditional-polite-request");
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it("caches contextual explanations per sentence, separately from the generic one", async () => {
    const [vouloir] = await d.select().from(atoms).where(sql`${atoms.type} = 'word' and ${atoms.key} = 'vouloir'`);
    const before = fake.mock.calls.length;
    const ctx = await askWhy(d, { atomId: vouloir.id, sentence: "Je voudrais un café." }, fake);
    expect(ctx.cached).toBe(false);
    expect(ctx.explanation).toBe("About vouloir in context.");
    const again = await askWhy(d, { atomId: vouloir.id, sentence: "Je voudrais un café." }, fake);
    expect(again.cached).toBe(true);
    expect(fake.mock.calls.length).toBe(before + 1);
  });

  it("works for a word with no atom yet and offers a new grammar atom", async () => {
    const answer = await askWhy(d, { lemma: "faille", surface: "faille", sentence: "Il faut que tu failles." }, fake);
    expect(answer.grammar).toMatchObject({ key: "subjunctive-after-il-faut", existing: false });
    const { atomId, created } = await addGrammarAtom(d, { key: answer.grammar!.key, title: answer.grammar!.title, explanation: answer.grammar!.explanation });
    expect(created).toBe(true);
    const [g] = await d.select().from(atoms).where(eq(atoms.id, atomId));
    expect(g).toMatchObject({ type: "grammar", key: "subjunctive-after-il-faut", gloss: "Subjunctive after il faut", status: "new", source: "conversation" });
    // Adding twice is a no-op.
    expect((await addGrammarAtom(d, { key: g.key, title: "x", explanation: "y" })).created).toBe(false);
    // Once it exists, a cached answer reports it as existing.
    const cached = await askWhy(d, { lemma: "faille", sentence: "Il faut que tu failles." }, fake);
    expect(cached.cached).toBe(true);
    expect(cached.grammar?.existing).toBe(true);
  });

  it("rejects an empty request", async () => {
    await expect(askWhy(d, {}, fake)).rejects.toThrow();
  });
});

describe("passage library", () => {
  const knownText = () => {
    // ~100 tokens from the 60 learned words plus 5 unknown ones: coverage ≈ 0.95.
    const known = (freq as FrequencyEntry[]).slice(0, 60).map((f) => f.lemma);
    return `${known.slice(0, 50).join(" ")} scontrino bizarre. ${known.slice(10, 60).join(" ")} zut flûte alors.`;
  };
  const fakeGenerate = vi.fn(async () => ({ title: "Généré", text: knownText() }));

  it("dueLemmas lists due known words", async () => {
    const due = await dueLemmas(d, 5, NOW);
    expect(due.length).toBe(5);
  });

  it("generates when nothing fits, stores the genre, and blocks a second unread generation", async () => {
    const r = await reuseOrGenerate(d, { targetCoverage: 0.95, genre: "short story", mustInclude: [] }, fakeGenerate, NOW);
    expect(r.reused).toBe(false);
    expect(fakeGenerate).toHaveBeenCalledTimes(1);
    const call = fakeGenerate.mock.calls[0] as unknown as [{ known: string[]; targetCoverage: number; genre: string }];
    expect(call[0].known.length).toBeGreaterThanOrEqual(60);
    expect(call[0].targetCoverage).toBe(0.95);
    const [row] = await d.select().from(passages).where(eq(passages.id, r.id));
    expect(row.origin).toBe("generated");
    expect(row.genre).toBe("short story");
    expect(row.coverage).toBeGreaterThan(0.9);
    expect(await unreadGenerated(d)).toMatchObject({ id: r.id });

    await expect(reuseOrGenerate(d, { targetCoverage: 0.9, genre: "dialogue", mustInclude: [] }, fakeGenerate, NOW)).rejects.toThrow(/Read "Généré"/);
    expect(fakeGenerate).toHaveBeenCalledTimes(1);
  });

  it("reuses a passage whose live coverage fits the band and that wasn't read recently", async () => {
    const [row] = await d.select().from(passages).where(eq(passages.origin, "generated"));
    // Unread: eligible. Coverage ~0.97 fits a 0.95 target (band -0.04/+0.02).
    const hit = await findReusable(d, { targetCoverage: 0.95, genre: "short story", mustInclude: [] }, NOW);
    expect(hit?.id).toBe(row.id);
    // Too far from target: not eligible.
    expect(await findReusable(d, { targetCoverage: 0.9, genre: "short story", mustInclude: [] }, NOW)).toBeUndefined();
    // mustInclude must overlap.
    expect(await findReusable(d, { targetCoverage: 0.95, genre: "short story", mustInclude: ["zzz-not-here"] }, NOW)).toBeUndefined();
    expect((await findReusable(d, { targetCoverage: 0.95, genre: "short story", mustInclude: ["zzz", "de"] }, NOW))?.id).toBe(row.id);

    // Reading it today makes it ineligible for a week; reuseOrGenerate then generates again.
    await openPassage(d, row.id, NOW);
    expect(await findReusable(d, { targetCoverage: 0.95, genre: "short story", mustInclude: [] }, NOW)).toBeUndefined();
    const later = new Date(NOW.getTime() + 8 * 86_400_000);
    expect((await findReusable(d, { targetCoverage: 0.95, genre: "short story", mustInclude: [] }, later))?.id).toBe(row.id);

    const before = fakeGenerate.mock.calls.length;
    const r2 = await reuseOrGenerate(d, { targetCoverage: 0.95, genre: "dialogue", mustInclude: [] }, fakeGenerate, NOW);
    expect(r2.reused).toBe(false);
    expect(fakeGenerate.mock.calls.length).toBe(before + 1);
  }, 60_000);

  it("imported passages are reusable too", async () => {
    const { id } = await createPassage(d, { text: knownText(), origin: "imported", title: "Importé" });
    const later = new Date(NOW.getTime() + 30 * 86_400_000);
    const hit = await findReusable(d, { targetCoverage: 0.95, genre: "news-style", mustInclude: [] }, later);
    expect(hit).toBeDefined();
    const [row] = await d.select({ coverage: passages.coverage }).from(passages).where(eq(passages.id, id));
    expect(row.coverage).toBeGreaterThan(0.9);
  });
});
