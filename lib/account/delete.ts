/**
 * Account deletion (suite-wide "delete my account", and Dolomite's own "delete my
 * data"): every row that carries the learner's user_id goes, in one statement so it
 * is all or nothing. Shared caches (speech_clips, why_cache, context_glosses,
 * sentence_translations) hold no user data and stay, as do the Blob clips.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

/**
 * Every table with a user_id column, children before the rows they reference so
 * the order reads FK-safe (the statement is atomic either way). schema-coverage in
 * delete.test.ts fails when a table gains a user_id column that isn't listed here.
 */
export const ACCOUNT_TABLES = [
  "api_receipts",
  "xp_events",
  "lesson_progress",
  "user_settings",
  "review_events",
  "encounters",
  "introductions",
  "produce_prompts",
  "scenario_visits",
  "scenarios",
  "sentences",
  "atoms",
  "passages",
  "goals", // goal_coverage cascades from goals
  "learners",
] as const;

/** Delete everything `userId` owns. Idempotent: a user with no rows deletes nothing. Returns the row count. */
export async function deleteAccountData(d: Db, userId: string): Promise<number> {
  const deletes = ACCOUNT_TABLES.map(
    (t, i) => sql`${sql.raw(`d${i}`)} as (delete from ${sql.identifier(t)} where user_id = ${userId}::uuid returning 1)`,
  );
  const counts = ACCOUNT_TABLES.map((_, i) => sql.raw(`(select count(*) from d${i})`));
  const res = await d.execute<{ n: string | number }>(sql`with ${sql.join(deletes, sql`, `)} select ${sql.join(counts, sql` + `)} as n`);
  const rows = (Array.isArray(res) ? res : (res as { rows: { n: string | number }[] }).rows) as { n: string | number }[];
  return Number(rows[0]?.n ?? 0);
}
