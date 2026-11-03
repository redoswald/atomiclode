/**
 * Every learner has their own atoms, passages, scenes and goals; only the
 * model caches (why_cache, context_glosses, sentence_translations) are shared.
 * A learner's starter content (the seed atoms and visit 1 of each seed scene)
 * is copied in the first time they open a language. Pure DB code: the
 * request-side entry point is learner() in lib/learner.ts.
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, learners } from "@/db/schema";
import { seedAtoms, type SeedFiles } from "@/db/seed/run";
import { seedScenarios } from "@/db/seed/scenarios";
import chunksEl from "@/db/seed/chunks-el.json";
import chunksFr from "@/db/seed/chunks-fr.json";
import freqFr from "@/db/seed/frequency-fr.json";
import grammarEl from "@/db/seed/grammar-el.json";
import grammarFr from "@/db/seed/grammar-fr.json";
import scenariosEl from "@/db/seed/scenarios-el.json";
import scenariosFr from "@/db/seed/scenarios-fr.json";
import wordsEl from "@/db/seed/words-el.json";
import type { ChunkEntry, GrammarEntry, WordEntry } from "@/lib/atoms/seed";
import type { Lang } from "@/lib/lang";
import type { ScenarioEntry } from "@/lib/scenarios/seed";

/** Who a request acts for: the signed-in learner and the track they have open. */
export interface Learner {
  /** auth.users.id */
  userId: string;
  lang: Lang;
}

/**
 * Owner of rows written before per-user data, and the identity used when auth
 * is off (LOCAL_USER in lib/auth.ts). claimLegacy hands its rows to a real user.
 */
export const NIL_USER = "00000000-0000-0000-0000-000000000000";

export const SEEDS: Record<Lang, { files: SeedFiles; scenarios: ScenarioEntry[] }> = {
  fr: {
    files: { freq: freqFr as WordEntry[], chunks: chunksFr as ChunkEntry[], grammar: grammarFr as GrammarEntry[] },
    scenarios: scenariosFr as ScenarioEntry[],
  },
  el: {
    files: { freq: wordsEl as WordEntry[], chunks: chunksEl as ChunkEntry[], grammar: grammarEl as GrammarEntry[] },
    scenarios: scenariosEl as ScenarioEntry[],
  },
};

/**
 * Copy (or refresh) one learner's starter content for one language. Idempotent:
 * memory state, progress and generated visits are never touched.
 */
export async function seedLearner(d: Db, userId: string, lang: Lang, now = new Date()) {
  const seed = SEEDS[lang];
  const result = await seedAtoms(d, userId, seed.files, lang);
  await borrowGlosses(d, userId, lang);
  const scenes = await seedScenarios(d, userId, seed.scenarios, lang, now);
  return { ...result, ...scenes };
}

/**
 * Glosses are content, not progress: a word glossed in the app for one learner
 * (the French seed ships mostly unglossed) fills the same word for this one.
 */
export async function borrowGlosses(d: Db, userId: string, lang: Lang): Promise<void> {
  await d.execute(sql`
    update ${atoms} as a set gloss = b.gloss
    from (
      select distinct on (type, key) type, key, gloss from ${atoms}
      where lang = ${lang} and gloss <> '' and user_id <> ${userId}::uuid
      order by type, key
    ) as b
    where a.user_id = ${userId}::uuid and a.lang = ${lang} and a.gloss = '' and a.type = b.type and a.key = b.key`);
}

/** A claim this old with no readyAt belongs to a request that died; take it over. */
export const STALE_CLAIM_MS = 2 * 60_000;
const WAIT_STEP_MS = 500;
const WAIT_MAX_MS = 60_000;

/**
 * Make sure the learner's starter content for `lang` is in place. Costs one
 * query once it is. The first request to get here claims the work (the row in
 * `learners`); concurrent ones, such as link prefetches, wait for it.
 */
export async function ensureLearner(d: Db, userId: string, lang: Lang, opts: { now?: () => Date; sleep?: (ms: number) => Promise<void> } = {}): Promise<void> {
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const mine = and(eq(learners.userId, userId), eq(learners.lang, lang));

  for (let waited = 0; ; waited += WAIT_STEP_MS) {
    const [row] = await d.select().from(learners).where(mine);
    if (row?.readyAt) return;

    let claimed = false;
    if (!row) {
      claimed = (await d.insert(learners).values({ userId, lang, claimedAt: now().toISOString() }).onConflictDoNothing().returning()).length > 0;
    } else if (now().getTime() - new Date(row.claimedAt).getTime() > STALE_CLAIM_MS) {
      claimed =
        (
          await d
            .update(learners)
            .set({ claimedAt: now().toISOString() })
            .where(and(mine, eq(learners.claimedAt, row.claimedAt), isNull(learners.readyAt)))
            .returning()
        ).length > 0;
    }

    if (claimed) {
      try {
        await seedLearner(d, userId, lang, now());
      } catch (err) {
        await d.delete(learners).where(and(mine, isNull(learners.readyAt)));
        throw err;
      }
      await d.update(learners).set({ readyAt: now().toISOString() }).where(mine);
      return;
    }
    // Someone else is provisioning. Past the wait, carry on with what is there.
    if (waited >= WAIT_MAX_MS) return;
    await sleep(WAIT_STEP_MS);
  }
}

/** Tables whose rows carry a user_id; the order doesn't matter, it is one statement. */
const OWNED = ["atoms", "sentences", "passages", "review_events", "encounters", "goals", "scenarios", "scenario_visits", "produce_prompts", "learners"] as const;

/**
 * Hand everything written before per-user data (owned by NIL_USER) to `userId`,
 * in one statement so it is all or nothing. Only for a user with no data of
 * their own yet, since their atoms would collide with the legacy ones. Returns
 * whether anything moved.
 */
export async function claimLegacy(d: Db, userId: string): Promise<boolean> {
  if (userId === NIL_USER) return false;
  const [legacy] = await d.select({ lang: learners.lang }).from(learners).where(eq(learners.userId, NIL_USER)).limit(1);
  if (!legacy) return false;
  const [own] = await d.select({ lang: learners.lang }).from(learners).where(eq(learners.userId, userId)).limit(1);
  if (own) {
    console.warn(`claimLegacy: ${userId} already has data of their own; legacy rows left with the nil user.`);
    return false;
  }
  const updates = OWNED.map((t, i) => sql`${sql.raw(`u${i}`)} as (update ${sql.identifier(t)} set user_id = ${userId}::uuid where user_id = ${NIL_USER}::uuid returning 1)`);
  await d.execute(sql`with ${sql.join(updates, sql`, `)} select ${sql.join(OWNED.map((_, i) => sql.raw(`(select count(*) from u${i})`)), sql` + `)} as n`);
  return true;
}

/**
 * Re-run the seed for every learner already set up (db:prepare on each deploy,
 * db:seed by hand), so edited seed files and new seed words reach everyone.
 */
export async function refreshLearners(d: Db, log: (line: string) => void = console.log): Promise<number> {
  const rows = await d.select({ userId: learners.userId, lang: learners.lang }).from(learners).where(isNotNull(learners.readyAt));
  for (const r of rows) {
    if (r.lang !== "fr" && r.lang !== "el") continue;
    const res = await seedLearner(d, r.userId, r.lang);
    log(`${r.lang} ${r.userId}: ${res.upserted} atoms, ${res.visitsWritten} first visits written${res.unglossed ? `, ${res.unglossed} seed words unglossed` : ""}`);
  }
  return rows.length;
}
