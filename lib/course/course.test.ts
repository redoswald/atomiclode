import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { atoms, lessonProgress } from "@/db/schema";
import { seedLearner, type Learner } from "@/lib/learners/provision";
import { newAtomOrder } from "@/lib/review/newOrder";
import { scenarioStates } from "@/lib/scenarios/visits";
import { courseProblems } from "./check";
import { COURSES, completedLessons } from "./index";
import { nextLesson, pathStates, sceneOpen, unitProgress } from "./path";
import { predictReading, readingMatches } from "./reading";
import type { Course } from "./types";
import { validateCourse } from "./validate";

const el = COURSES.el!;

describe("the Greek course", () => {
  it("is valid against the seed: resolvable, readable, decodable, no repeats", () => {
    expect(courseProblems()).toEqual([]);
  });

  it("is Unit 1 as specified: 13 lessons and the café checkpoint, 29 script units", () => {
    const unit = el.units[0];
    expect(unit.lessons).toHaveLength(14);
    expect(unit.lessons.at(-1)).toMatchObject({ kind: "checkpoint", scene: "el-cafe" });
    expect(new Set(unit.lessons.flatMap((l) => l.letters ?? [])).size).toBe(29);
  });
});

describe("predicted readings", () => {
  const all = new Set(["τ", "α", "ξ", "ι", "ο", "μ", "ε", "ρ", "κ", "φ", "σ", "ου", "λ", "π", "ει", "ν", "η", "χ", "ω", "υ", "αι", "ευ", "γγ", "ντ", "μπ", "τσ", "θ", "δ", "γ"]);
  const say = (w: string) => predictReading(w, all, new Set());

  it("sounds words out with positional and voicing rules", () => {
    expect(say("ντομάτα")).toBe("domata");
    expect(say("πέντε")).toBe("pende");
    expect(say("μια μπίρα")).toBe("mia bira");
    expect(say("ευχαριστώ")).toBe("efcharisto");
    expect(say("ευρώ")).toBe("evro");
    expect(say("τσάι")).toBe("tsai");
    expect(say("μιλάτε αγγλικά;")).toBe("milate anglika");
  });

  it("can't sound out the sight words to their readings", () => {
    expect(readingMatches(say("γεια σας")!, "ya sas")).toBe(false);
    expect(readingMatches(say("συγγνώμη")!, "signómi")).toBe(false);
    expect(readingMatches(say("με συγχωρείτε")!, "me sinchoríte")).toBe(false);
    expect(predictReading("βάρκα", all, new Set())).toBeUndefined();
  });

  it("matches any of a reading's alternatives, ignoring accents and punctuation", () => {
    expect(readingMatches("o", "o / i / to")).toBe(true);
    expect(readingMatches("poso kani", "póso káni?")).toBe(true);
  });
});

describe("the validator", () => {
  const seed = [
    { key: "ταξί", romanization: "taxí" },
    { key: "μετρό", romanization: "metró" },
    { key: "γεια σας", romanization: "ya sas" },
  ];
  const course = (items: Array<{ key: string; mode?: "sight" | "heard" }>, letters = ["τ", "α", "ξ", "ι"], kind: "letters" | "phrases" = "letters"): Course => ({
    lang: "el",
    units: [
      {
        id: "u",
        cefr: "A1.1",
        title: "t",
        canDo: [],
        scenes: ["s"],
        lessons: [
          { id: "l1", title: "L1", kind, letters, items },
          { id: "l2", title: "check", kind: "checkpoint", items: [], scene: "s" },
        ],
      },
    ],
  });
  const problems = (c: Course) => validateCourse(c, seed, ["s"]);

  it("passes a good lesson", () => {
    expect(problems(course([{ key: "ταξί" }]))).toEqual([]);
  });

  it("catches unreadable, undecodable, unknown, repeated items and unused letters", () => {
    expect(problems(course([{ key: "ταξί" }, { key: "μετρό" }])).join()).toMatch(/μετρό" needs μ ε ρ/);
    expect(problems(course([{ key: "ταξί" }, { key: "γεια σας" }], ["τ", "α", "ξ", "ι", "γ", "ει", "σ"])).join()).toMatch(/γεια σας" sounds out as "gia sas"/);
    expect(problems(course([{ key: "ταξί" }, { key: "γεια σας", mode: "sight" }], ["τ", "α", "ξ", "ι", "γ", "ει", "σ"]))).toEqual([]);
    expect(problems(course([{ key: "πίτσα" }])).join()).toMatch(/not in the seed/);
    expect(problems(course([{ key: "ταξί" }, { key: "ταξί" }])).join()).toMatch(/introduced twice/);
    expect(problems(course([{ key: "ταξί" }], ["τ", "α", "ξ", "ι", "ω"])).join()).toMatch(/teaches ω but no item uses it/);
    expect(problems(course([{ key: "ταξί" }, { key: "μετρό", mode: "heard" }])).join()).toMatch(/heard-first outside a phrases lesson/);
  });
});

describe("the path", () => {
  const ids = el.units[0].lessons.map((l) => l.id);

  it("opens one lesson at a time, in order", () => {
    const fresh = pathStates(el, new Set());
    expect(fresh.map((p) => p.state).slice(0, 3)).toEqual(["current", "locked", "locked"]);
    expect(nextLesson(el, new Set(ids.slice(0, 3)))?.lesson.id).toBe(ids[3]);
    expect(nextLesson(el, new Set(ids))).toBeUndefined();
    expect(unitProgress(el.units[0], new Set(ids.slice(0, 7)))).toEqual({ done: 7, total: 14 });
  });

  it("opens the café with Unit 1 and other scenes after its checkpoint", () => {
    expect(sceneOpen(el, new Set(), "el-cafe")).toBe(true);
    expect(sceneOpen(el, new Set(), "el-ferry")).toBe(false);
    expect(sceneOpen(el, new Set(ids), "el-ferry")).toBe(true);
  });
});

describe("a live course in the database", () => {
  const USER = "44444444-4444-4444-8444-444444444444";
  const me: Learner = { userId: USER, lang: "el" };
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

  it("stops review from introducing words on its own", async () => {
    const off = await newAtomOrder(d, me, false, { courseLive: false });
    expect(off.newOrder.length).toBeGreaterThan(0);
    const on = await newAtomOrder(d, me, false, { courseLive: true });
    expect(on).toMatchObject({ newOrder: [], noFrequencyFallback: true, blocked: [] });
  });

  it("shows only the scenes the path has reached", async () => {
    expect((await scenarioStates(d, me, { courseLive: false })).length).toBe(9);
    expect((await scenarioStates(d, me, { courseLive: true })).map((s) => s.scenario.slug)).toEqual(["el-cafe"]);
    await d.insert(lessonProgress).values(el.units[0].lessons.map((l) => ({ userId: USER, lang: "el", lessonId: l.id })));
    expect(await completedLessons(d, me)).toHaveProperty("size", 14);
    expect((await scenarioStates(d, me, { courseLive: true })).length).toBe(9);
  });

  it("retires an untouched formal number card, keeps a studied one, and seeds the everyday ones", async () => {
    // A learner seeded before the rename has the formal cards; one of them studied.
    await d.insert(atoms).values([
      { userId: USER, lang: "el", type: "word", key: "επτά", gloss: "seven", source: "frequency", status: "new" },
      { userId: USER, lang: "el", type: "word", key: "οκτώ", gloss: "eight", source: "frequency", status: "review", reps: 3, stability: 9 },
    ]);
    await seedLearner(d, USER, "el");
    const keys = (await d.select({ key: atoms.key }).from(atoms).where(and(eq(atoms.userId, USER), eq(atoms.lang, "el")))).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["εφτά", "οχτώ", "εννιά", "πίτσα", "είμαι από την Αμερική", "οκτώ"]));
    expect(keys).not.toContain("επτά");
  }, 60_000);
});
