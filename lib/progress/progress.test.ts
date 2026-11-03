import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { atoms, reviewEvents, xpEvents } from "@/db/schema";
import { emptyModalityStats, newMemoryState, type Atom } from "@/lib/atoms/types";
import { COURSES } from "@/lib/course";
import { fadedLessons, slipping } from "@/lib/course/fading";
import { buildLesson, completeLesson, completeRefresh } from "@/lib/course/lesson";
import { seedLearner, type Learner } from "@/lib/learners/provision";
import { planSession } from "@/lib/scheduler";
import { awardXp, dayIn, progressFor, reviewXp, saveSettings, streak, weeklyXp } from "./xp";

const days = (pairs: Array<[string, number]>) => new Map(pairs);

describe("the streak", () => {
  const goal = 40;

  it("counts consecutive days at goal, today included once met", () => {
    const d = days([["2026-11-01", 40], ["2026-11-02", 55], ["2026-11-03", 41]]);
    expect(streak(d, goal, "2026-11-03")).toEqual({ days: 3, restDays: [], today: true });
  });

  it("keeps the run while today is still open", () => {
    const d = days([["2026-11-01", 40], ["2026-11-02", 55], ["2026-11-03", 10]]);
    expect(streak(d, goal, "2026-11-03")).toMatchObject({ days: 2, today: false });
  });

  it("forgives one missed day a week as a rest day, not a second", () => {
    const one = days([["2026-10-30", 40], ["2026-10-31", 40], ["2026-11-01", 0], ["2026-11-02", 40], ["2026-11-03", 40]]);
    expect(streak(one, goal, "2026-11-03")).toEqual({ days: 4, restDays: ["2026-11-01"], today: true });
    const two = days([["2026-10-29", 40], ["2026-10-30", 0], ["2026-10-31", 40], ["2026-11-01", 0], ["2026-11-02", 40], ["2026-11-03", 40]]);
    expect(streak(two, goal, "2026-11-03")).toMatchObject({ days: 3, restDays: ["2026-11-01"] });
  });

  it("holds a rest day yesterday while today is open", () => {
    const d = days([["2026-10-31", 40], ["2026-11-01", 40], ["2026-11-02", 0]]);
    expect(streak(d, goal, "2026-11-03")).toMatchObject({ days: 2, restDays: ["2026-11-02"] });
  });

  it("is zero with no run", () => {
    expect(streak(new Map(), goal, "2026-11-03")).toEqual({ days: 0, restDays: [], today: false });
  });
});

describe("experience", () => {
  it("earns reviews by time: a five-minute round is about 10", () => {
    expect(reviewXp("recognize")).toBe(0.2);
    expect(reviewXp("recall")).toBe(0.5);
    expect(reviewXp("produce")).toBeCloseTo(1.33, 2);
  });

  it("sums weeks from Monday, most recent last", () => {
    const w = weeklyXp(days([["2026-11-02", 10], ["2026-11-03", 20], ["2026-10-30", 7]]), "2026-11-04", 2);
    expect(w).toEqual([
      { week: "2026-10-26", xp: 7 },
      { week: "2026-11-02", xp: 30 },
    ]);
  });

  it("finds the learner's own day", () => {
    const at = new Date("2026-11-04T03:00:00Z");
    expect(dayIn(at, "UTC")).toBe("2026-11-04");
    expect(dayIn(at, "America/New_York")).toBe("2026-11-03");
  });
});

describe("in the database", () => {
  const USER = "66666666-6666-4666-8666-666666666666";
  const me: Learner = { userId: USER, lang: "el" };
  const ids = COURSES.el!.units[0].lessons.map((l) => l.id);
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

  it("awards once per ref and reports today, the goal and the streak in the learner's zone", async () => {
    await saveSettings(d, USER, { dailyGoal: 20, timeZone: "America/New_York" });
    const now = new Date("2026-11-04T15:00:00Z");
    await awardXp(d, me, "lesson", 25, ids[0], now);
    await awardXp(d, me, "lesson", 25, ids[0], now);
    await awardXp(d, me, "review", 0.5, undefined, now);
    await awardXp(d, me, "review", 0.5, undefined, now);
    // 02:00 UTC on the 4th is still the 3rd in New York.
    await awardXp(d, me, "passage", 20, "passage:x:2026-11-03", new Date("2026-11-04T02:00:00Z"));
    expect(await d.select().from(xpEvents).where(eq(xpEvents.userId, USER))).toHaveLength(4);
    const p = await progressFor(d, USER, now);
    expect(p).toMatchObject({ today: "2026-11-04", todayXp: 26, totalXp: 46, settings: { dailyGoal: 20, timeZone: "America/New_York" } });
    expect(p.streak).toMatchObject({ days: 2, today: true });
  });

  it("fades a lesson whose words are slipping, and a Refresh counts as reviews", async () => {
    const now = new Date("2026-11-04T18:00:00Z");
    await completeLesson(d, me, ids[0], {}, now);
    expect((await fadedLessons(d, me, now)).size).toBe(0);
    // Ten days later nothing has been reviewed: everything is overdue.
    const later = new Date("2026-11-14T18:00:00Z");
    const faded = await fadedLessons(d, me, later);
    expect(faded.get(ids[0])?.length).toBe(8);
    const p = await buildLesson(d, me, ids[0], { canSay: false, refresh: true, now: later });
    expect(p.refresh).toBe(true);
    const taxi = p.items.find((i) => i.key === "ταξί")!;
    const res = await completeRefresh(d, me, ids[0], { [taxi.atomId]: { attempts: 1, misses: 0, firstTimeRight: true } }, later);
    expect(res).toEqual({ reviewed: 1 });
    const events = await d.select().from(reviewEvents).where(and(eq(reviewEvents.userId, USER), eq(reviewEvents.atomId, taxi.atomId)));
    expect(events).toHaveLength(1);
    const [row] = await d.select().from(atoms).where(eq(atoms.id, taxi.atomId));
    expect(slipping(row, later)).toBe(false);
  });

  it("won't refresh a lesson that isn't finished", async () => {
    await expect(completeRefresh(d, me, ids[5], {})).rejects.toThrow("Only a finished lesson");
  });
});

describe("review rounds", () => {
  const due = (n: number): Atom => ({
    id: `a${n}`,
    lang: "el",
    type: "word",
    key: `w${n}`,
    forms: [],
    gloss: "g",
    domains: [],
    relatedAtoms: [],
    memory: { ...newMemoryState("2026-11-01T00:00:00Z"), status: "review", stability: 10, reps: 5, due: "2026-11-02T00:00:00Z" },
    modality: emptyModalityStats(),
    createdAt: "2026-11-01T00:00:00Z",
    source: "frequency",
  });

  it("don't triage a pile the intensity's budget would have worked through", () => {
    // About 50 recognize cards fit five minutes; triage starts past three times that.
    const pile = Array.from({ length: 200 }, (_, i) => due(i));
    const req = { now: "2026-11-04T00:00:00Z", timeBudgetMin: 5, newAtomsPerDay: 0, newAtomsIntroducedToday: 0, intensity: "steady" as const };
    const plain = planSession(pile, [], req);
    expect(plain.deferred).toBeGreaterThan(0);
    const round = planSession(pile, [], { ...req, triageScale: 12 / 5 });
    expect(round.deferred).toBe(0);
    expect(round.dueLeft).toBe(200 - round.items.length);
  });
});
