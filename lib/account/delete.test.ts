import { PGlite } from "@electric-sql/pglite";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { seedLearner } from "@/lib/learners/provision";
import { ACCOUNT_TABLES, deleteAccountData } from "./delete";
import { deleteAccount } from "./handler";

const SHARED = ["speech_clips", "why_cache", "context_glosses", "sentence_translations"];

/** Every table exported from db/schema.ts. */
const TABLES = (Object.values(schema) as unknown[]).filter((v): v is PgTable => v instanceof PgTable);

/** Every table in db/schema.ts with a user_id column. */
function tablesWithUserId(): string[] {
  return TABLES.map((t) => getTableConfig(t))
    .filter((c) => c.columns.some((col) => col.name === "user_id"))
    .map((c) => c.name)
    .sort();
}

describe("schema coverage", () => {
  it("deletes from every table that has a user_id column", () => {
    // A new table with a user_id must be added to ACCOUNT_TABLES in lib/account/delete.ts.
    expect([...ACCOUNT_TABLES].sort()).toEqual(tablesWithUserId());
  });

  it("leaves only the shared caches and goal_coverage (cascades from goals) without a user_id", () => {
    const all = TABLES.map((t) => getTableConfig(t).name);
    const rest = all.filter((n) => !(ACCOUNT_TABLES as readonly string[]).includes(n)).sort();
    expect(rest).toEqual([...SHARED, "goal_coverage"].sort());
  });
});

describe("DELETE /api/v1/account", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let client: PGlite;
  let d: ReturnType<typeof drizzle<typeof schema>>;

  /** One row (cross-referenced like real data) in every user-owned table. */
  async function fill(userId: string, tag: string) {
    const [passage] = await d.insert(schema.passages).values({ userId, origin: "imported", text: `p ${tag}` }).returning();
    const [atom] = await d.insert(schema.atoms).values({ userId, type: "word", key: `k-${tag}`, source: "manual" }).returning();
    const [sentence] = await d.insert(schema.sentences).values({ userId, text: `s ${tag}`, origin: "imported", passageId: passage.id }).returning();
    await d.insert(schema.reviewEvents).values({ userId, atomId: atom.id, modality: "recall", sentenceId: sentence.id, grade: 3, responseMs: 900 });
    await d.insert(schema.encounters).values({ userId, atomId: atom.id, sentenceId: sentence.id, passageId: passage.id });
    const [goal] = await d.insert(schema.goals).values({ userId, title: `g ${tag}` }).returning();
    await d.insert(schema.goalCoverage).values({ goalId: goal.id, day: "2026-11-01", coverage: 0.5 });
    const [scenario] = await d.insert(schema.scenarios).values({ userId, slug: `sc-${tag}`, title: "t", brief: "b", origin: "custom", goalId: goal.id }).returning();
    const [visit] = await d.insert(schema.scenarioVisits).values({ userId, scenarioId: scenario.id, n: 1, brief: "b", passageId: passage.id }).returning();
    await d.insert(schema.producePrompts).values({ userId, visitId: visit.id, situation: "x", exampleAnswer: "y" });
    await d.insert(schema.introductions).values({ userId, atomId: atom.id, lessonId: "l1", due: "2026-11-02T00:00:00Z", firstTimeRight: true, attempts: 1, misses: 0 });
    await d.insert(schema.apiReceipts).values({ userId, clientId: crypto.randomUUID(), kind: "lesson", response: {} });
    await d.insert(schema.xpEvents).values({ userId, lang: "el", kind: "lesson", amount: 25, ref: "l1" });
    await d.insert(schema.userSettings).values({ userId });
    await d.insert(schema.lessonProgress).values({ userId, lang: "el", lessonId: "l1" });
    await d.insert(schema.learners).values({ userId, lang: "fr" });
  }

  const count = async (table: string, userId?: string) => {
    const where = userId ? sql` where user_id = ${userId}::uuid` : sql``;
    const r = await d.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)}${where}`);
    return Number(r.rows[0].n);
  };
  const owned = async (userId: string): Promise<Record<string, number>> => Object.fromEntries(await Promise.all(ACCOUNT_TABLES.map(async (t) => [t, await count(t, userId)])));

  const req = (auth?: string) => new Request("https://x/api/v1/account", { method: "DELETE", headers: auth ? { authorization: auth } : {} });
  const as = (id: string, email = "anyone@example.com") => async (token: string) => (token === "ok" ? { id, email, name: null } : null);

  beforeAll(async () => {
    client = new PGlite();
    d = drizzle(client, { schema });
    await migrate(d, { migrationsFolder: "./drizzle" });
    await seedLearner(d, A, "el"); // a real learner's starter content…
    await fill(A, "a"); // …plus a row in every table
    await fill(B, "b");
    await d.insert(schema.speechClips).values({ key: "c1", lang: "el", voice: "v", rate: "normal", text: "γεια", url: "https://blob/c1", bytes: 1 });
    await d.insert(schema.whyCache).values({ atomKey: "k-a", explanation: "e" });
    await d.insert(schema.contextGlosses).values({ lemma: "l", sentence: "s", gloss: "g" });
    await d.insert(schema.sentenceTranslations).values({ sentence: "s a", translation: "t" });
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const authOn = () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("ALLOWED_EMAILS", "aaron@example.com");
  };

  it("rejects a missing or bad token with 401 and deletes nothing", async () => {
    authOn();
    const before = await owned(A);
    expect((await deleteAccount(req(), () => d, as(A))).status).toBe(401);
    expect((await deleteAccount(req("Bearer bad"), () => d, as(A))).status).toBe(401);
    expect(await owned(A)).toEqual(before);
  });

  it("refuses with sign-in off rather than deleting the local learner", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const before = await owned(A);
    const res = await deleteAccount(req("Bearer ok"), () => d, as(A));
    expect(res.status).toBe(403);
    expect(await owned(A)).toEqual(before);
  });

  it("deletes every row of one user — even one not on ALLOWED_EMAILS — and nothing else", async () => {
    authOn();
    expect(Object.values(await owned(A)).every((n) => n > 0)).toBe(true);
    const bBefore = await owned(B);
    const shared = await Promise.all(SHARED.map((t) => count(t)));
    const coverage = await count("goal_coverage");

    const res = await deleteAccount(req("Bearer ok"), () => d, as(A, "stranger@example.com"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });

    expect(Object.values(await owned(A)).every((n) => n === 0)).toBe(true);
    expect(await owned(B)).toEqual(bBefore);
    expect(await Promise.all(SHARED.map((t) => count(t)))).toEqual(shared);
    expect(await count("goal_coverage")).toBe(coverage - 1); // A's, by cascade
  });

  it("is idempotent: a second delete (or a user with no rows) is a 200 no-op", async () => {
    authOn();
    const res = await deleteAccount(req("Bearer ok"), () => d, as(A));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(await deleteAccountData(d, crypto.randomUUID())).toBe(0);
    expect(Object.values(await owned(B)).every((n) => n > 0)).toBe(true);
  });

  it("answers a database failure with 500 retryable, and no database with 503 retryable", async () => {
    authOn();
    const broken = { execute: async () => { throw new Error("connection reset"); } } as never;
    const res = await deleteAccount(req("Bearer ok"), () => broken, as(B));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "error" }, retryable: true });
    const none = await deleteAccount(req("Bearer ok"), () => null, as(B));
    expect(none.status).toBe(503);
    expect(await none.json()).toMatchObject({ retryable: true });
    expect(Object.values(await owned(B)).every((n) => n > 0)).toBe(true);
  });
});
