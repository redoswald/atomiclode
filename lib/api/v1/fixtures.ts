/**
 * Contract fixtures (SPEC §19): one real response per endpoint, built against an
 * in-memory database with fixed times and a fixed random seed, ids and times
 * replaced by placeholders. The iOS app's tests decode these; the API tests
 * check they are current, so a change to a response's shape shows up on both
 * sides. Regenerate with `npm run api:fixtures`.
 */
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { atoms, scenarios } from "@/db/schema";
import { seedLearner, type Learner } from "@/lib/learners/provision";
import { getLesson, getMe, getPath, getReview, getScene, postLessonComplete, postReview } from "./handlers";
import { parseCapabilities } from "./http";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})/g;

/** Same shape, stable text: ids and instants become placeholders. */
export function normalize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).replace(UUID, "00000000-0000-4000-8000-000000000000").replace(TIME, "2026-11-10T12:00:00.000Z"));
}

const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

export async function buildFixtures(): Promise<Record<string, unknown>> {
  const client = new PGlite();
  const d = drizzle(client, { schema });
  try {
    await migrate(d, { migrationsFolder: "./drizzle" });
    const USER = "88888888-8888-4888-8888-888888888888";
    const me: Learner = { userId: USER, lang: "el" };
    const user = { id: USER, email: "learner@example.com", name: "Learner" };
    const caps = parseCapabilities("ios/1.0; exercises=meaning,hear,decode,pairs,build,say,sound; cards=recognize,recall,cloze,decode,listen,produce");
    const now = new Date("2026-11-10T12:00:00Z");
    await seedLearner(d, USER, "el", now);

    const lesson = await getLesson(d, me, "el-1-01", caps, { now, rnd: seeded() });
    const complete = await postLessonComplete(d, me, "el-1-01", { clientId: "11111111-1111-4111-8111-111111111111", answeredAt: "2026-11-10T12:00:00Z", stats: {} }, now);
    const [taxi] = await d.select({ id: atoms.id }).from(atoms).where(and(eq(atoms.userId, USER), eq(atoms.key, "ταξί")));
    const review = await postReview(d, me, { clientId: "22222222-2222-4222-8222-222222222222", atomId: taxi.id, modality: "recognize", grade: 3, responseMs: 1200, answeredAt: "2026-11-11T09:00:00Z" }, new Date("2026-11-11T12:00:00Z"));
    const round = await getReview(d, me, caps, { intensity: "steady" }, new Date("2026-11-12T12:00:00Z"));
    const [cafe] = await d.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.userId, USER), eq(scenarios.slug, "el-cafe")));
    const scene = await getScene(d, me, cafe.id);
    const meRes = await getMe(d, user, me, now);
    const path = await getPath(d, me, now);
    return Object.fromEntries(
      Object.entries({ me: meRes, path, lesson, "lesson-complete": complete, review: round, "review-result": review, scene }).map(([k, v]) => [k, normalize(v)]),
    );
  } finally {
    await client.close();
  }
}
