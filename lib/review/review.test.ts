/**
 * Integration: seed an in-memory Postgres, plan a session, record reviews,
 * and check the next plan reflects them.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { atoms, reviewEvents } from "@/db/schema";
import chunks from "@/db/seed/chunks-fr.json";
import freq from "@/db/seed/frequency-fr.json";
import grammar from "@/db/seed/grammar-fr.json";
import { seedAtoms } from "@/db/seed/run";
import type { ChunkEntry, FrequencyEntry, GrammarEntry } from "@/lib/atoms/seed";
import { recordReview } from "./record";
import { buildSession, newAtomsIntroducedToday } from "./session";

let client: PGlite;
let d: ReturnType<typeof drizzle<typeof schema>>;
const NOW = new Date("2026-09-10T12:00:00Z");

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  await seedAtoms(d, { freq: freq as FrequencyEntry[], chunks: chunks as ChunkEntry[], grammar: grammar as GrammarEntry[] });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("review flow", () => {
  it("plans new atoms only where a gloss exists, chunks and grammar first", async () => {
    const s = await buildSession(d, "steady", NOW);
    expect(s.cards).toHaveLength(10);
    expect(s.cards.every((c) => c.reason === "new" && c.modality === "recognize")).toBe(true);
    // Frequency words have no gloss yet, so nothing new comes from them.
    expect(s.cards.every((c) => c.gloss.trim() !== "")).toBe(true);
    expect(s.cards.every((c) => c.type !== "word")).toBe(true);
    expect(s.plan.deferred).toBe(0);
  }, 60_000);

  it("records a review, updates memory, and counts toward today's new-atom allowance", async () => {
    const s = await buildSession(d, "steady", NOW);
    const first = s.cards[0];
    const result = await recordReview(d, { atomId: first.atomId, modality: "recognize", grade: 3, responseMs: 2500 }, NOW);
    expect(result.status).toBe("learning");

    const [row] = await d.select().from(atoms).where(eq(atoms.id, first.atomId));
    expect(row.status).toBe("learning");
    expect(row.reps).toBe(1);
    expect(row.modality.recognize).toMatchObject({ attempts: 1, correct: 1 });
    const [{ n }] = await d.select({ n: sql<number>`count(*)::int` }).from(reviewEvents);
    expect(n).toBe(1);
    expect(await newAtomsIntroducedToday(d, NOW)).toBe(1);

    // The next plan: 9 new (allowance minus one) plus the learning step, which is due within the session.
    const later = new Date(NOW.getTime() + 60_000);
    const next = await buildSession(d, "steady", later);
    const learning = next.cards.filter((c) => c.atomId === first.atomId);
    expect(learning).toHaveLength(1);
    expect(learning[0].reason).toBe("due");
    expect(next.cards.filter((c) => c.reason === "new")).toHaveLength(9);
  }, 60_000);

  it("light sessions review only", async () => {
    const s = await buildSession(d, "light", new Date(NOW.getTime() + 60_000));
    expect(s.cards.every((c) => c.reason !== "new")).toBe(true);
  }, 60_000);

  it("rejects bad input", async () => {
    await expect(recordReview(d, { atomId: "00000000-0000-0000-0000-000000000000", modality: "recognize", grade: 3, responseMs: 1 })).rejects.toThrow(
      "unknown atom",
    );
    await expect(recordReview(d, { atomId: "x", modality: "recognize", grade: 9 as never, responseMs: 1 })).rejects.toThrow("grade");
  });
});
