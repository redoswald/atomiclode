/**
 * Per-user data (PGlite, no model): two learners get their own starter copies,
 * never see or change each other's data, and the pre-accounts rows can be
 * claimed by their owner.
 */
import { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { atoms, learners, passages, producePrompts, reviewEvents, scenarios } from "@/db/schema";
import { homeCounts } from "@/lib/atoms/stats";
import { createPassage, openPassage } from "@/lib/reader/passages";
import { checkProduce } from "@/lib/review/produce";
import { recordReview } from "@/lib/review/record";
import { buildSession } from "@/lib/review/session";
import { scenarioStates, startVisit } from "@/lib/scenarios/visits";
import { borrowGlosses, claimLegacy, ensureLearner, NIL_USER, SEEDS, type Learner } from "./provision";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const meA: Learner = { userId: A, lang: "el" };
const meB: Learner = { userId: B, lang: "el" };
const EL_ATOMS = SEEDS.el.files.freq.length + SEEDS.el.files.chunks.length + SEEDS.el.files.grammar.length;
const noWait = { sleep: async () => {} };

let client: PGlite;
let d: ReturnType<typeof drizzle<typeof schema>>;

const atomCount = async (userId: string) =>
  (await d.select({ n: sql<number>`count(*)::int` }).from(atoms).where(eq(atoms.userId, userId)))[0].n;

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("provisioning", () => {
  it("copies the starter content on first visit, once", async () => {
    await ensureLearner(d, A, "el", noWait);
    expect(await atomCount(A)).toBeGreaterThanOrEqual(EL_ATOMS);
    const scenes = await scenarioStates(d, meA);
    expect(scenes).toHaveLength(SEEDS.el.scenarios.length);
    expect(scenes.every((s) => s.visits.length === 1)).toBe(true);
    const [row] = await d.select().from(learners).where(eq(learners.userId, A));
    expect(row.readyAt).not.toBeNull();

    const before = await atomCount(A);
    await ensureLearner(d, A, "el", noWait);
    expect(await atomCount(A)).toBe(before);
  }, 60_000);

  it("gives a second learner a separate copy", async () => {
    await ensureLearner(d, B, "el", noWait);
    expect(await atomCount(B)).toBe(await atomCount(A));
    const shared = await d.execute(sql`select count(*)::int as n from atoms a join atoms b on a.id = b.id where a.user_id = ${A}::uuid and b.user_id = ${B}::uuid`);
    expect((shared.rows[0] as { n: number }).n).toBe(0);
  }, 60_000);

  it("lets only one of two concurrent first visits do the work", async () => {
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await Promise.all([ensureLearner(d, C, "el", noWait), ensureLearner(d, C, "el", noWait)]);
    expect(await atomCount(C)).toBe(await atomCount(A));
    expect(await d.select().from(scenarios).where(eq(scenarios.userId, C))).toHaveLength(SEEDS.el.scenarios.length);
  }, 60_000);

  it("fills a missing gloss from another learner's copy", async () => {
    const [word] = await d
      .select()
      .from(atoms)
      .where(and(eq(atoms.userId, B), eq(atoms.type, "word"), sql`${atoms.gloss} <> ''`))
      .limit(1);
    await d.update(atoms).set({ gloss: "" }).where(eq(atoms.id, word.id));
    await borrowGlosses(d, B, "el");
    const [after] = await d.select().from(atoms).where(eq(atoms.id, word.id));
    expect(after.gloss).toBe(word.gloss);
  });
});

describe("isolation", () => {
  it("keeps reviews to the learner who made them", async () => {
    const [aWord] = await d
      .select()
      .from(atoms)
      .where(and(eq(atoms.userId, A), eq(atoms.type, "word")))
      .limit(1);
    const bBefore = await homeCounts(d, meB);

    await recordReview(d, A, { atomId: aWord.id, modality: "recognize", grade: 3, responseMs: 1500 });
    expect((await homeCounts(d, meA)).reviewsTotal).toBe(1);
    expect(await homeCounts(d, meB)).toEqual(bBefore);

    await expect(recordReview(d, B, { atomId: aWord.id, modality: "recognize", grade: 1, responseMs: 1500 })).rejects.toThrow("unknown atom");
    const events = await d.select().from(reviewEvents);
    expect(events).toHaveLength(1);
    expect(events[0].userId).toBe(A);
  });

  it("builds a session from the learner's own atoms only", async () => {
    const session = await buildSession(d, meB, "push", new Date(), { produce: false });
    expect(session.cards.length).toBeGreaterThan(0);
    const ids = session.cards.map((c) => c.atomId);
    const owners = await d.select({ userId: atoms.userId }).from(atoms).where(sql`${atoms.id} in ${ids}`);
    expect(new Set(owners.map((o) => o.userId))).toEqual(new Set([B]));
  });

  it("won't open, start or check another learner's passage, visit or prompt", async () => {
    const { id: passageId } = await createPassage(d, A, { lang: "el", text: "Καλημέρα. Ένα καφέ, παρακαλώ. Ευχαριστώ πολύ.", origin: "imported" });
    expect(await openPassage(d, B, passageId)).toBeUndefined();
    expect(await openPassage(d, A, passageId)).toBeDefined();
    const [p] = await d.select().from(passages).where(eq(passages.id, passageId));
    expect(p.reads).toBe(1); // B's attempt didn't count a read

    const visit = (await scenarioStates(d, meA))[0].latest!.visit;
    await startVisit(d, B, visit.id);
    expect((await scenarioStates(d, meA))[0].latest!.visit.startedAt).toBeNull();

    const [prompt] = await d.select().from(producePrompts).where(eq(producePrompts.userId, A)).limit(1);
    await expect(checkProduce(d, B, prompt.id, "ένα καφέ", async () => ({ ok: true, natural: "", note: "", used: [] }))).rejects.toThrow("unknown prompt");
  });
});

describe("claiming the pre-accounts data", () => {
  it("hands the nil user's rows to the owner, all at once", async () => {
    const OWNER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await ensureLearner(d, NIL_USER, "el", noWait);
    const legacy = await atomCount(NIL_USER);
    expect(legacy).toBeGreaterThan(0);

    expect(await claimLegacy(d, OWNER)).toBe(true);
    expect(await atomCount(NIL_USER)).toBe(0);
    expect(await atomCount(OWNER)).toBe(legacy);
    expect(await d.select().from(learners).where(eq(learners.userId, NIL_USER))).toHaveLength(0);
    const [row] = await d.select().from(learners).where(eq(learners.userId, OWNER));
    expect(row.readyAt).not.toBeNull();
    expect(await claimLegacy(d, OWNER)).toBe(false);
  }, 60_000);

  it("refuses a user who already has data of their own", async () => {
    await ensureLearner(d, NIL_USER, "el", noWait);
    expect(await claimLegacy(d, A)).toBe(false);
    expect(await atomCount(NIL_USER)).toBeGreaterThan(0);
  }, 60_000);
});
