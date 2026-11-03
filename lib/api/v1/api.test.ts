import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { atoms, introductions, reviewEvents, scenarios, xpEvents } from "@/db/schema";
import { rowToAtom } from "@/lib/atoms/rows";
import { COURSES } from "@/lib/course";
import { seedLearner, type Learner } from "@/lib/learners/provision";
import { applyReview } from "@/lib/scheduler";
import { apiUser } from "./auth";
import { getLesson, getMe, getPath, getReview, getScene, postCheckpoint, postLessonComplete, postReview, postSceneTurnDone } from "./handlers";
import { answeredAt, degradeModality, errorResponse, parseCapabilities } from "./http";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("plumbing", () => {
  it("reads the capability header, with recognize as the floor", () => {
    const c = parseCapabilities("ios/1.0; exercises=meaning,hear,bogus; cards=recall");
    expect(c.client).toBe("ios/1.0");
    expect([...c.exercises]).toEqual(["meaning", "hear"]);
    expect([...c.cards].sort()).toEqual(["recall", "recognize"]);
    expect(parseCapabilities(null).exercises.size).toBe(7);
  });

  it("degrades a card the client can't draw down the cascade", () => {
    const only = (...m: string[]) => new Set(m) as never;
    expect(degradeModality("produce", only("recognize", "recall"))).toBe("recall");
    expect(degradeModality("produce", only("recognize"))).toBe("recognize");
    expect(degradeModality("cloze", only("recognize", "recall"))).toBe("recall");
    expect(degradeModality("listen", only("recognize", "recall"))).toBe("recognize");
    expect(degradeModality("decode", only("recognize", "decode"))).toBe("decode");
  });

  it("clamps answer times from the future or more than 30 days back", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(answeredAt("2026-11-09T08:00:00+02:00", now)).toEqual({ at: new Date("2026-11-09T06:00:00Z"), clamped: false });
    expect(answeredAt("2026-11-11T00:00:00Z", now)).toEqual({ at: now, clamped: true });
    expect(answeredAt("2026-09-01T00:00:00Z", now).clamped).toBe(true);
    expect(answeredAt(undefined, now)).toEqual({ at: now, clamped: false });
    expect(() => answeredAt("yesterday", now)).toThrow("ISO");
  });

  it("maps domain errors to stable codes", async () => {
    const locked = errorResponse(new Error("That lesson isn't open yet: finish the one before it first."));
    expect(locked.status).toBe(409);
    expect((await locked.json()).error.code).toBe("lesson_locked");
  });
});

describe("bearer auth", () => {
  const request = (auth?: string) => new Request("https://x/api/v1/me", { headers: auth ? { authorization: auth } : {} });
  const user = { id: "u", email: "aaron@example.com", name: null };

  it("needs a valid token from an allowed account", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("ALLOWED_EMAILS", "aaron@example.com");
    await expect(apiUser(request(), async () => user)).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    await expect(apiUser(request("Bearer bad"), async () => null)).rejects.toMatchObject({ status: 401 });
    await expect(apiUser(request("Bearer ok"), async () => ({ ...user, email: "stranger@example.com" }))).rejects.toMatchObject({ status: 403, code: "not_allowed" });
    await expect(apiUser(request("Bearer ok"), async () => user)).resolves.toEqual(user);
  });
});

describe("endpoints", () => {
  const USER = "77777777-7777-4777-8777-777777777777";
  const me: Learner = { userId: USER, lang: "el" };
  const user = { id: USER, email: "local@localhost", name: null };
  const all = parseCapabilities(null);
  const ids = COURSES.el!.units[0].lessons.map((l) => l.id);
  const NOW = new Date("2026-11-10T12:00:00Z");
  let client: PGlite;
  let d: ReturnType<typeof drizzle<typeof schema>>;
  const uuid = () => crypto.randomUUID();

  beforeAll(async () => {
    client = new PGlite();
    d = drizzle(client, { schema });
    await migrate(d, { migrationsFolder: "./drizzle" });
    await seedLearner(d, USER, "el");
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  it("GET /me and /path describe the learner and the course", async () => {
    const m = await getMe(d, user, me, NOW);
    expect(m).toMatchObject({ lang: "el", todayXp: 0, settings: { dailyGoal: 40 } });
    expect(m.tracks.find((t) => t.lang === "el")?.courseLive).toBe(true);
    const p = await getPath(d, me);
    expect(p.live).toBe(true);
    expect(p.units[0].lessons[0]).toMatchObject({ id: ids[0], state: "current", faded: false });
    expect(p.units[0].lessons.at(-1)?.sceneId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await getPath(d, { userId: USER, lang: "fr" })).live).toBe(false);
  });

  it("GET /lessons/:id builds only the exercise kinds the client can draw", async () => {
    const { lesson } = await getLesson(d, me, ids[0], parseCapabilities("ios/1.0; exercises=meaning,hear; cards=recognize"));
    expect(lesson.exercises.length).toBeGreaterThan(0);
    expect(new Set(lesson.exercises.map((e) => e.kind))).toEqual(new Set(["meaning", "hear"]));
    await expect(getLesson(d, me, ids[1], all)).rejects.toThrow("isn't open yet");
  });

  it("POST /lessons/:id/complete is idempotent and lands at the answer's time", async () => {
    const clientId = uuid();
    const given = "2026-11-08T20:00:00+02:00"; // on a plane, two days ago
    const first = await postLessonComplete(d, me, ids[0], { clientId, answeredAt: given, stats: {} }, NOW);
    const again = await postLessonComplete(d, me, ids[0], { clientId, answeredAt: given, stats: {} }, NOW);
    expect(again).toEqual(first);
    expect(first).toMatchObject({ kind: "lesson", added: 8, replay: false, xp: 25 });
    const intros = await d.select().from(introductions).where(eq(introductions.userId, USER));
    expect(intros).toHaveLength(8);
    expect(new Date(intros[0].at).toISOString()).toBe("2026-11-08T18:00:00.000Z");
    const xp = await d.select().from(xpEvents).where(and(eq(xpEvents.userId, USER), eq(xpEvents.kind, "lesson")));
    expect(xp).toHaveLength(1);
    expect(new Date(xp[0].at).toISOString().slice(0, 10)).toBe("2026-11-08");
  });

  it("POST /reviews rebuilds an atom when an older answer arrives late", async () => {
    const [taxi] = await d.select().from(atoms).where(and(eq(atoms.userId, USER), eq(atoms.key, "ταξί")));
    // Tuesday on the web (Good), then Monday's offline answer (Again) arrives.
    await postReview(d, me, { clientId: uuid(), atomId: taxi.id, modality: "recognize", grade: 3, responseMs: 900, answeredAt: "2026-11-10T09:00:00Z" }, NOW);
    await postReview(d, me, { clientId: uuid(), atomId: taxi.id, modality: "recognize", grade: 1, responseMs: 900, answeredAt: "2026-11-09T09:00:00Z" }, NOW);
    const events = await d.select().from(reviewEvents).where(eq(reviewEvents.atomId, taxi.id));
    expect(events).toHaveLength(2);
    // The same two answers applied in time order, from the introduced state.
    const [intro] = await d.select().from(introductions).where(eq(introductions.atomId, taxi.id));
    const { introducedMemoryState } = await import("@/lib/scheduler/introduce");
    let a = rowToAtom({ ...taxi, modality: {} as never });
    a = { ...a, memory: introducedMemoryState(intro), modality: { ...a.modality } };
    a = applyReview(a, { atomId: taxi.id, modality: "recognize", grade: 1, responseMs: 900, at: "2026-11-09T09:00:00.000Z" });
    a = applyReview(a, { atomId: taxi.id, modality: "recognize", grade: 3, responseMs: 900, at: "2026-11-10T09:00:00.000Z" });
    const [after] = await d.select().from(atoms).where(eq(atoms.id, taxi.id));
    expect(after.lapses).toBe(a.memory.lapses);
    expect(after.reps).toBe(a.memory.reps);
    expect(after.stability).toBeCloseTo(a.memory.stability, 4);
  });

  it("POST /reviews returns the first response for a repeated clientId", async () => {
    const [mera] = await d.select().from(atoms).where(and(eq(atoms.userId, USER), eq(atoms.key, "ο")));
    const clientId = uuid();
    const body = { clientId, atomId: mera.id, modality: "recognize", grade: 3, responseMs: 500, answeredAt: "2026-11-10T10:00:00Z" };
    const one = await postReview(d, me, body, NOW);
    const two = await postReview(d, me, body, NOW);
    expect(two).toEqual(one);
    expect(await d.select().from(reviewEvents).where(eq(reviewEvents.atomId, mera.id))).toHaveLength(1);
    await expect(postLessonComplete(d, me, ids[0], { clientId, stats: {} }, NOW)).rejects.toMatchObject({ code: "client_id_reused" });
  });

  it("GET /review gives only card modalities the client lists", async () => {
    const r = await getReview(d, me, parseCapabilities("ios/1.0; exercises=meaning; cards=recognize"), { intensity: "push" }, new Date("2026-11-12T12:00:00Z"));
    expect(r.cards.length).toBeGreaterThan(0);
    expect(new Set(r.cards.map((c) => c.modality))).toEqual(new Set(["recognize"]));
    expect(r).toMatchObject({ round: 1, minutes: 5 });
  });

  it("GET /scenes/:id opens the café with its lines, voices, translations and prompts", async () => {
    const [cafe] = await d.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.userId, USER), eq(scenarios.slug, "el-cafe")));
    const s = await getScene(d, me, cafe.id);
    expect(s.visit?.lines.length).toBeGreaterThan(4);
    expect(new Set(s.visit!.lines.map((l) => l.voice))).toEqual(new Set([0, 1]));
    expect(s.visit!.lines[0].translation).toBeTruthy();
    expect(s.visit!.prompts.length).toBeGreaterThan(0);
    expect(s.visit!.checkpointLessonId).toBeNull();
    expect(await postSceneTurnDone(d, me, s.visit!.id, NOW)).toEqual({ xp: 15 });
    await expect(postCheckpoint(d, me, ids.at(-1)!)).rejects.toThrow("isn't open yet");
  });
});

describe("contract fixtures", () => {
  it("are current: regenerate with `npm run api:fixtures` after changing a response", async () => {
    const { readFileSync } = await import("node:fs");
    const { buildFixtures } = await import("./fixtures");
    const built = await buildFixtures();
    for (const [name, value] of Object.entries(built)) {
      const committed = JSON.parse(readFileSync(`lib/api/v1/fixtures/${name}.json`, "utf8"));
      expect(value, `${name}.json is stale`).toEqual(committed);
    }
  }, 60_000);
});
