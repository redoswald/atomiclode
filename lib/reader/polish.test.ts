/**
 * Milestone 5 integration (PGlite, no model): stats, adaptations, and
 * exposure signals flowing through session building.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { atoms, encounters, passages } from "@/db/schema";
import chunks from "@/db/seed/chunks-fr.json";
import freq from "@/db/seed/frequency-fr.json";
import grammar from "@/db/seed/grammar-fr.json";
import { seedAtoms } from "@/db/seed/run";
import type { ChunkEntry, FrequencyEntry, GrammarEntry } from "@/lib/atoms/seed";
import { corpusCoverageOf, vocabStats } from "@/lib/atoms/vocab-stats";
import { recordReview } from "@/lib/review/record";
import { buildSession, insightFor } from "@/lib/review/session";
import { emptyModalityStats, newMemoryState, type Atom } from "@/lib/atoms/types";
import { adaptationsOf, adaptPassage, unreadGenerated } from "./library";
import { createPassage } from "./passages";

let client: PGlite;
let d: ReturnType<typeof drizzle<typeof schema>>;
const NOW = new Date("2026-09-10T12:00:00Z");
const FREQ = freq as FrequencyEntry[];

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  await seedAtoms(d, { freq: FREQ, chunks: chunks as ChunkEntry[], grammar: grammar as GrammarEntry[] });
  await d
    .update(atoms)
    .set({ status: "review", stability: 30, difficulty: 5, scheduledDays: 30, reps: 3, due: "2026-10-01T00:00:00Z", lastReview: "2026-09-01T00:00:00Z" })
    .where(sql`${atoms.type} = 'word' and ${atoms.frequencyRank} <= 40`);
  await d
    .update(atoms)
    .set({ status: "review", stability: 5, difficulty: 5, scheduledDays: 5, reps: 2, due: "2026-09-12T00:00:00Z", lastReview: "2026-09-07T00:00:00Z" })
    .where(sql`${atoms.type} = 'word' and ${atoms.frequencyRank} between 41 and 60`);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("stats", () => {
  it("corpus coverage weights by frequency", () => {
    const top = FREQ.slice(0, 10).map((f) => f.lemma);
    const bottom = FREQ.slice(-10).map((f) => f.lemma);
    expect(corpusCoverageOf(top)).toBeGreaterThan(corpusCoverageOf(bottom) * 20);
    expect(corpusCoverageOf([])).toBe(0);
    expect(corpusCoverageOf(FREQ.map((f) => f.lemma))).toBeCloseTo(1);
  });

  it("buckets vocabulary and builds a series from the review log", async () => {
    const before = await vocabStats(d, NOW);
    expect(before.total).toBe(60);
    expect(before.strong).toBe(40);
    expect(before.developing).toBe(20);
    expect(before.fragile).toBe(0);
    expect(before.words).toBe(60);
    expect(before.corpusCoverage).toBeGreaterThan(0.2);
    // No reviews yet: the series is just today at 0.
    expect(before.series).toEqual([{ date: "2026-09-10", coverage: 0, known: 0 }]);

    const [w] = await d.select().from(atoms).where(sql`${atoms.type} = 'word' and ${atoms.frequencyRank} = 41`);
    await recordReview(d, { atomId: w.id, modality: "recognize", grade: 3, responseMs: 1000 }, new Date("2026-09-08T10:00:00Z"));
    // Tap it three times this week → fragile.
    for (let i = 0; i < 3; i++) {
      await d.insert(encounters).values({ atomId: w.id, tapped: true, at: new Date(NOW.getTime() - i * 86_400_000).toISOString() });
    }
    const after = await vocabStats(d, NOW);
    expect(after.fragile).toBe(1);
    expect(after.series.map((p) => p.date)).toEqual(["2026-09-08", "2026-09-10"]);
    expect(after.series[0].known).toBe(1);
    expect(after.series[0].coverage).toBeGreaterThan(0);
  });

  it("insightFor reads the modality balance", () => {
    const base: Atom = {
      id: "x", lang: "fr", type: "word", key: "x", forms: [], gloss: "", domains: [], relatedAtoms: [],
      memory: { ...newMemoryState("2026-09-01T00:00:00Z"), status: "review" }, modality: emptyModalityStats(), createdAt: "2026-09-01T00:00:00Z", source: "frequency",
    };
    expect(insightFor(base)).toBeUndefined();
    const lopsided = { ...base, modality: { ...emptyModalityStats(), recognize: { attempts: 5, correct: 5 }, recall: { attempts: 3, correct: 1 } } };
    expect(insightFor(lopsided)).toMatch(/production needs work/);
    const solid = { ...base, modality: { ...emptyModalityStats(), recognize: { attempts: 5, correct: 5 }, recall: { attempts: 3, correct: 3 } } };
    expect(insightFor(solid)).toBe("Solid both ways.");
    expect(insightFor({ ...base, memory: { ...base.memory, lapses: 3 } })).toMatch(/Slippery/);
  });
});

describe("exposure through the session", () => {
  it("pulls a tapped-often word forward and bumps untapped ones without moving due", async () => {
    const [fragile] = await d.select().from(atoms).where(sql`${atoms.type} = 'word' and ${atoms.frequencyRank} = 41`);
    const [seen] = await d.select().from(atoms).where(sql`${atoms.type} = 'word' and ${atoms.frequencyRank} = 1`);
    await d.insert(encounters).values({ atomId: seen.id, tapped: false, at: NOW.toISOString() });

    const session = await buildSession(d, "steady", NOW);
    expect(session.cards.some((c) => c.atomId === fragile.id)).toBe(true);
    const [f] = await d.select().from(atoms).where(eq(atoms.id, fragile.id));
    expect(new Date(f.due).getTime()).toBeLessThanOrEqual(NOW.getTime());
    const [s] = await d.select().from(atoms).where(eq(atoms.id, seen.id));
    expect(s.stability).toBeGreaterThan(30);
    expect(new Date(s.due).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(session.cards.some((c) => c.atomId === seen.id)).toBe(false);
  }, 60_000);
});

describe("adapt this text", () => {
  const fakeAdapt = vi.fn(async (input: { level: string; text: string }) => ({
    title: `Adapté (${input.level})`,
    text: `${FREQ.slice(0, 50).map((f) => f.lemma).join(" ")} scontrino. ${FREQ.slice(0, 50).map((f) => f.lemma).join(" ")}.`,
  }));

  it("creates one adaptation per level, reuses it, and keeps it out of the generation cap", async () => {
    const { id } = await createPassage(d, { text: "Un texte original assez long pour être importé sans problème, avec plusieurs mots.", origin: "imported", title: "Original" });
    const a = await adaptPassage(d, id, "balanced", fakeAdapt);
    expect(a.reused).toBe(false);
    expect(fakeAdapt.mock.calls[0][0].level).toBe("balanced");
    const [row] = await d.select().from(passages).where(eq(passages.id, a.id));
    expect(row.origin).toBe("generated");
    expect(row.sourceRef).toBe(`passage:${id}#balanced`);
    expect(row.title).toBe("Adapté (balanced)");

    const again = await adaptPassage(d, id, "balanced", fakeAdapt);
    expect(again).toMatchObject({ id: a.id, reused: true });
    expect(fakeAdapt).toHaveBeenCalledTimes(1);

    const b = await adaptPassage(d, id, "comfortable", fakeAdapt);
    expect(await adaptationsOf(d, id)).toEqual({ balanced: a.id, comfortable: b.id });
    // Unread adaptations don't block "read something new".
    expect(await unreadGenerated(d)).toBeUndefined();
  }, 60_000);

  it("refuses an unknown passage", async () => {
    await expect(adaptPassage(d, "00000000-0000-0000-0000-000000000000", "balanced", fakeAdapt)).rejects.toThrow("unknown passage");
  });
});
