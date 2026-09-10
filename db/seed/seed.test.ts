/**
 * Integration test: applies the real migrations to an in-memory Postgres
 * (PGlite), seeds it twice, and checks the home-screen counts.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { atoms, reviewEvents } from "@/db/schema";
import type { ChunkEntry, FrequencyEntry, GrammarEntry } from "@/lib/atoms/seed";
import { homeCounts } from "@/lib/atoms/stats";
import chunks from "./chunks-fr.json";
import freq from "./frequency-fr.json";
import grammar from "./grammar-fr.json";
import { seedAtoms } from "./run";

const files = {
  freq: freq as FrequencyEntry[],
  chunks: chunks as ChunkEntry[],
  grammar: grammar as GrammarEntry[],
};

let client: PGlite;
let d: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("migrations + seed", () => {
  it("seeds every atom and links chunks", async () => {
    const result = await seedAtoms(d, files);
    expect(result.upserted).toBe(files.freq.length + files.chunks.length + files.grammar.length);
    expect(result.linked).toBe(files.chunks.length);

    const [{ n }] = await d.select({ n: sql<number>`count(*)::int` }).from(atoms);
    expect(n).toBe(result.upserted);

    const [jeVoudrais] = await d.select().from(atoms).where(eq(atoms.key, "je voudrais"));
    expect(jeVoudrais.type).toBe("chunk");
    // je, vouloir, conditional-polite-request
    expect(jeVoudrais.relatedAtoms).toHaveLength(3);
  }, 60_000);

  it("is idempotent and preserves memory state on re-run", async () => {
    const [before] = await d.select().from(atoms).where(eq(atoms.key, "vouloir"));
    await d
      .update(atoms)
      .set({ status: "review", stability: 12.5, reps: 4, gloss: "stale gloss" })
      .where(eq(atoms.id, before.id));

    const result = await seedAtoms(d, files);
    expect(result.upserted).toBe(files.freq.length + files.chunks.length + files.grammar.length);

    const [{ n }] = await d.select({ n: sql<number>`count(*)::int` }).from(atoms);
    expect(n).toBe(result.upserted);

    const [after] = await d.select().from(atoms).where(eq(atoms.key, "vouloir"));
    expect(after.id).toBe(before.id);
    expect(after.status).toBe("review");
    expect(after.stability).toBe(12.5);
    expect(after.reps).toBe(4);
    // Seed data (gloss) is refreshed from the file.
    expect(after.gloss).toBe(files.freq.find((f) => f.lemma === "vouloir")!.gloss);
  }, 60_000);

  it("homeCounts reflects status, due, and review history", async () => {
    const now = new Date("2026-09-10T12:00:00Z");
    const [vouloir] = await d.select().from(atoms).where(eq(atoms.key, "vouloir"));
    await d.update(atoms).set({ due: "2026-09-09T00:00:00Z" }).where(eq(atoms.id, vouloir.id));
    await d.insert(reviewEvents).values({
      atomId: vouloir.id,
      modality: "recognize",
      grade: 3,
      responseMs: 4200,
      at: "2026-09-01T09:00:00Z",
    });

    const counts = await homeCounts(now, d);
    expect(counts.day).toBe(10);
    expect(counts.total).toBe(files.freq.length + files.chunks.length + files.grammar.length);
    expect(counts.byStatus.review).toBe(1);
    expect(counts.byStatus.new).toBe(counts.total - 1);
    expect(counts.dueNow).toBe(1);
    expect(counts.newAvailable.word).toBe(files.freq.length - 1);
    expect(counts.newAvailable.chunk).toBe(files.chunks.length);
    expect(counts.newAvailable.grammar).toBe(files.grammar.length);
    expect(counts.byType).toEqual({
      word: files.freq.length,
      chunk: files.chunks.length,
      grammar: files.grammar.length,
    });
    expect(counts.reviewsTotal).toBe(1);
  }, 60_000);
});
