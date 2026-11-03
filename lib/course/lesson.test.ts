import { PGlite } from "@electric-sql/pglite";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { atoms, introductions, lessonProgress, scenarios, scenarioVisits } from "@/db/schema";
import { rowToAtom } from "@/lib/atoms/rows";
import { seedLearner, type Learner } from "@/lib/learners/provision";
import { replay } from "@/lib/scheduler";
import { spreadFirstReviews } from "@/lib/scheduler/introduce";
import { buildExercises, oneSyllable } from "./exercises";
import { COURSES, completedLessons } from "./index";
import { buildLesson, completeCheckpoint, completeLesson, currentCheckpoint } from "./lesson";

const USER = "55555555-5555-4555-8555-555555555555";
const me: Learner = { userId: USER, lang: "el" };
const NOW = new Date("2026-11-04T18:00:00Z");
const ids = COURSES.el!.units[0].lessons.map((l) => l.id);
// A fixed sequence so exercise generation is repeatable.
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

let client: PGlite;
let d: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  await seedLearner(d, USER, "el");
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("building a lesson", () => {
  it("shows lesson 1's letters then its words, with practice for each", async () => {
    const p = await buildLesson(d, me, ids[0], { canSay: true, rnd: seeded() });
    expect(p.items.map((i) => i.key)).toEqual(["letter:τ", "letter:α", "letter:ξ", "letter:ι", "letter:ο", "ταξί", "τι", "ο"]);
    // ταξί is also a sign, so it's shown as one.
    expect(p.items.find((i) => i.key === "ταξί")).toMatchObject({ decodable: true, known: false, display: "ΤΑΞΙ" });
    expect(p.exercises.length).toBeGreaterThanOrEqual(8);
    expect(p.exercises.length).toBeLessThanOrEqual(15);
    const kinds = new Set(p.exercises.map((e) => e.kind));
    expect(kinds).toContain("sound");
    expect(kinds).toContain("decode");
    // "τι" and "ο" are one syllable: never "say it".
    const said = p.exercises.filter((e) => e.kind === "say").map((e) => ("item" in e ? e.item : ""));
    const short = p.items.filter((i) => ["τι", "ο"].includes(i.key)).map((i) => i.atomId);
    expect(said.some((s) => short.includes(s))).toBe(false);
  });

  it("refuses a locked lesson", async () => {
    await expect(buildLesson(d, me, ids[1], { canSay: false })).rejects.toThrow("isn't open yet");
  });

  it("never offers sound-it-out for sight words or not-yet-readable phrases", async () => {
    await d.insert(lessonProgress).values([ids[0], ids[1]].map((lessonId) => ({ userId: USER, lang: "el", lessonId })));
    const p = await buildLesson(d, me, ids[2], { canSay: false, rnd: seeded(3) });
    expect(p.items.every((i) => !i.decodable)).toBe(true);
    expect(p.exercises.some((e) => e.kind === "decode")).toBe(false);
    await d.delete(lessonProgress).where(eq(lessonProgress.userId, USER));
  });
});

describe("finishing a lesson", () => {
  it("hands new items to review, due tomorrow, and opens the next lesson", async () => {
    const p = await buildLesson(d, me, ids[0], { canSay: false, rnd: seeded() });
    const taxi = p.items.find((i) => i.key === "ταξί")!;
    const res = await completeLesson(d, me, ids[0], { [taxi.atomId]: { attempts: 3, misses: 1, firstTimeRight: false } }, NOW);
    expect(res).toEqual({ added: 8, alreadyKnown: 0, replay: false });
    const rows = await d.select().from(atoms).where(and(eq(atoms.userId, USER), inArray(atoms.key, ["ταξί", "letter:τ"])));
    for (const r of rows) {
      expect(r.status).toBe("learning");
      expect(r.due.slice(0, 10)).toBe("2026-11-05");
    }
    const [intro] = await d.select().from(introductions).where(eq(introductions.atomId, taxi.atomId));
    expect(intro).toMatchObject({ lessonId: ids[0], firstTimeRight: false, attempts: 3, misses: 1 });
    expect((await completedLessons(d, me)).has(ids[0])).toBe(true);
    expect((await buildLesson(d, me, ids[1], { canSay: false })).lessonId).toBe(ids[1]);
  });

  it("is what replay rebuilds from the introductions log", async () => {
    const rows = await d.select().from(atoms).where(and(eq(atoms.userId, USER), eq(atoms.key, "ταξί")));
    const intros = (await d.select().from(introductions)).map((i) => ({ atomId: i.atomId, at: i.at, due: i.due, firstTimeRight: i.firstTimeRight }));
    const [rebuilt] = replay(rows.map(rowToAtom), [], [], intros);
    const live = rowToAtom(rows[0]);
    expect(rebuilt.memory).toMatchObject({ status: live.memory.status, due: new Date(live.memory.due).toISOString(), stability: live.memory.stability });
  });

  it("doesn't hand anything off again on a replay", async () => {
    const res = await completeLesson(d, me, ids[0], {}, NOW);
    expect(res).toEqual({ added: 0, alreadyKnown: 8, replay: true });
    const [row] = await d.select({ plays: lessonProgress.plays }).from(lessonProgress).where(and(eq(lessonProgress.userId, USER), eq(lessonProgress.lessonId, ids[0])));
    expect(row.plays).toBe(2);
  });

  it("spreads a heavy day's first reviews over the following days", async () => {
    // Lessons 2 and 3 on the same evening: 3 + 4 + 5 items on top of lesson 1's 8 = 20 > 15.
    await completeLesson(d, me, ids[1], {}, NOW);
    await completeLesson(d, me, ids[2], {}, NOW);
    const dues = (await d.select({ due: introductions.due }).from(introductions).where(eq(introductions.userId, USER))).map((r) => r.due.slice(0, 10));
    const perDay = dues.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
    expect(perDay.get("2026-11-05")).toBe(15);
    expect(perDay.get("2026-11-06")).toBe(dues.length - 15);
  });

  it("skips an item the learner already has", async () => {
    // Lesson 4 teaches καφές; say the learner met it in a scene and has reviewed it.
    await d.update(atoms).set({ status: "review", reps: 4, stability: 12 }).where(and(eq(atoms.userId, USER), eq(atoms.key, "καφές")));
    const res = await completeLesson(d, me, ids[3], {}, NOW);
    expect(res.alreadyKnown).toBe(1);
    const [row] = await d.select().from(atoms).where(and(eq(atoms.userId, USER), eq(atoms.key, "καφές")));
    expect(row).toMatchObject({ status: "review", reps: 4, stability: 12 });
  });
});

describe("the checkpoint", () => {
  it("passes only once its scene has been opened", async () => {
    await d.insert(lessonProgress).values(ids.slice(4, 13).map((lessonId) => ({ userId: USER, lang: "el", lessonId })));
    expect(await currentCheckpoint(d, me, "el-cafe")).toBe(ids[13]);
    await expect(completeCheckpoint(d, me, ids[13])).rejects.toThrow("Open the scene first");
    const [cafe] = await d.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.userId, USER), eq(scenarios.slug, "el-cafe")));
    await d.update(scenarioVisits).set({ startedAt: NOW.toISOString() }).where(eq(scenarioVisits.scenarioId, cafe.id));
    await completeCheckpoint(d, me, ids[13]);
    expect((await completedLessons(d, me)).size).toBe(14);
  });
});

describe("pure parts", () => {
  it("spreads first reviews past a full day", () => {
    const out = spreadFirstReviews(NOW, 4, new Map([["2026-11-05", 14]]), 15);
    expect(out.map((x) => x.slice(0, 10))).toEqual(["2026-11-05", "2026-11-06", "2026-11-06", "2026-11-06"]);
  });

  it("counts one-syllable words", () => {
    expect(oneSyllable("ναι")).toBe(true);
    expect(oneSyllable("τι")).toBe(true);
    expect(oneSyllable("όχι")).toBe(false);
    expect(oneSyllable("γεια σας")).toBe(false);
  });

  it("caps practice at 15 and keeps every item", () => {
    const item = (n: number) => ({ atomId: `a${n}`, key: `καφές${n}`, display: `καφές${n}`, gloss: `g${n}`, romanization: "kafes", type: "chunk" as const, isLetter: false, decodable: true, known: false, lang: "el" as const });
    const many = Array.from({ length: 6 }, (_, i) => item(i));
    const ex = buildExercises({ items: many, recent: [], pool: many, canSay: true }, seeded());
    expect(ex.length).toBeLessThanOrEqual(15);
    for (const m of many) expect(ex.some((e) => ("item" in e && e.item === m.atomId) || (e.kind === "pairs" && e.items.includes(m.atomId)))).toBe(true);
  });
});
