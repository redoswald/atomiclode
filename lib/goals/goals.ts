/**
 * Goal texts (SPEC §11): a text the learner can't read yet and wants to. Pinning
 * one splits it into sections, lets its unknown words lead the new-atom order in
 * the reading phase, tracks its coverage day by day, and builds a ladder of
 * easier versions up to the original.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, goalCoverage, goals, passages, type GoalRow, type PassageRow } from "@/db/schema";
import type { Level } from "@/lib/llm/adapt";
import { glossLemmas, type GlossRequest } from "@/lib/llm/gloss";
import { surveyText, type Survey, type SurveyInput } from "@/lib/llm/survey";
import { computeCoverage, isKnownStatus, type AtomLite } from "@/lib/reader/coverage";
import { GOAL_SECTION_GENRE } from "@/lib/reader/library";
import { createPassage } from "@/lib/reader/passages";
import { sectionize } from "./sections";

/** The gist rung is offered from this many known atoms; below it even a summary is mostly unknown words. */
export const GIST_MIN_KNOWN = 300;
/** A rung is recommended when its coverage, recomputed today, is at least this. */
export const RUNG_READABLE = 0.9;
/** A rung is stale once the learner knows this much more than when it was written. */
export const RUNG_STALE_GROWTH = 0.15;
/** The goal is reached at this coverage of the original, once every section has been read. */
export const GOAL_REACHED = 0.95;
/** A goal word becomes a card if it appears this often in the goal, or is on the frequency list at all. */
export const GOAL_WORD_MIN_COUNT = 2;

export const LADDER: readonly Level[] = ["gist", "comfortable", "balanced", "challenging"];

interface AtomIndexRow extends AtomLite {
  type: "word" | "chunk" | "grammar";
  rank: number | null;
}

async function atomIndex(d: Db) {
  const rows = await d
    .select({ id: atoms.id, key: atoms.key, type: atoms.type, status: atoms.status, gloss: atoms.gloss, rank: atoms.frequencyRank })
    .from(atoms)
    .where(inArray(atoms.type, ["word", "chunk"]));
  const words = new Map<string, AtomIndexRow>();
  const chunks = new Map<string, AtomIndexRow>();
  for (const r of rows) (r.type === "chunk" ? chunks : words).set(r.key, r);
  return { words, chunks, knownCount: rows.filter((r) => isKnownStatus(r.status)).length };
}

// ---- pinning ---------------------------------------------------------------------

/**
 * Pin an imported passage as the goal. Long texts are re-imported as sections of
 * ~300 words; a short one is its own single section. Any other active goal waits.
 */
export async function pinGoal(d: Db, passageId: string, now = new Date()): Promise<string> {
  const [original] = await d.select().from(passages).where(eq(passages.id, passageId));
  if (!original) throw new Error("unknown passage");
  if (original.origin !== "imported") throw new Error("Only a text you imported can be a goal.");
  const [already] = await d.select({ id: goals.id }).from(goals).where(sql`${passageId}::uuid = any(${goals.passageIds})`);
  if (already) {
    await activate(d, already.id);
    return already.id;
  }

  const title = original.title ?? "Untitled";
  const parts = sectionize(original.text);
  let passageIds = [original.id];
  if (parts.length > 1) {
    passageIds = [];
    for (const [i, text] of parts.entries()) {
      const { id } = await createPassage(d, { title: `${title} · ${i + 1}/${parts.length}`, text, origin: "imported", sourceRef: original.sourceRef ?? undefined });
      passageIds.push(id);
    }
  }
  await d.update(passages).set({ genre: GOAL_SECTION_GENRE }).where(inArray(passages.id, passageIds));
  const [row] = await d.insert(goals).values({ title, passageIds, status: "waiting", pinnedAt: now.toISOString() }).returning({ id: goals.id });
  await activate(d, row.id);
  return row.id;
}

/** One active goal at a time (SPEC §11); the others wait in the library. */
export async function activate(d: Db, goalId: string): Promise<void> {
  await d.update(goals).set({ status: "waiting" }).where(eq(goals.status, "active"));
  await d.update(goals).set({ status: "active" }).where(and(eq(goals.id, goalId), sql`${goals.status} <> 'reached'`));
}

export async function activeGoal(d: Db): Promise<GoalRow | undefined> {
  const [row] = await d.select().from(goals).where(eq(goals.status, "active")).orderBy(desc(goals.pinnedAt)).limit(1);
  return row;
}

export async function listGoals(d: Db): Promise<GoalRow[]> {
  return d.select().from(goals).orderBy(desc(goals.pinnedAt));
}

// ---- coverage and the ladder ---------------------------------------------------------

export interface Rung {
  level: Level | "original";
  passageId?: string;
  /** Recomputed against today's atoms. */
  coverage?: number;
  stale: boolean;
}

export interface GoalSection {
  passage: Pick<PassageRow, "id" | "title" | "reads">;
  coverage: number;
  wordCount: number;
  rungs: Rung[];
  /** The highest rung readable today, if any. */
  recommended?: Rung;
}

export interface GoalView {
  goal: GoalRow;
  coverage: number;
  wordCount: number;
  /** Distinct unknown lemmas, and how many of them will become cards. */
  unknownLemmas: number;
  queued: number;
  knownAtoms: number;
  sections: GoalSection[];
  reached: boolean;
}

async function sectionRows(d: Db, goal: GoalRow): Promise<PassageRow[]> {
  if (goal.passageIds.length === 0) return [];
  const rows = await d.select().from(passages).where(inArray(passages.id, goal.passageIds));
  return goal.passageIds.flatMap((id) => rows.filter((r) => r.id === id));
}

/** The goal as it stands today. Logs today's coverage, and marks the goal reached when it is. */
export async function goalView(d: Db, goalId: string, now = new Date()): Promise<GoalView | undefined> {
  const [goal] = await d.select().from(goals).where(eq(goals.id, goalId));
  if (!goal) return undefined;
  const [index, rows] = await Promise.all([atomIndex(d), sectionRows(d, goal)]);
  const cover = (p: PassageRow) => computeCoverage(p.tokens, (l) => index.words.get(l), (k) => index.chunks.get(k));

  const refs = rows.flatMap((r) => LADDER.map((level) => `passage:${r.id}#${level}`));
  const adapted = refs.length ? await d.select().from(passages).where(inArray(passages.sourceRef, refs)).orderBy(asc(passages.createdAt)) : [];

  let known = 0;
  let total = 0;
  const sections: GoalSection[] = rows.map((p) => {
    const report = cover(p);
    known += report.knownCount;
    total += report.wordCount;
    const rungs: Rung[] = LADDER.map((level) => {
      const a = adapted.filter((x) => x.sourceRef === `passage:${p.id}#${level}`).pop();
      if (!a) return { level, stale: false };
      const grown = a.knownAtGeneration ? (index.knownCount - a.knownAtGeneration) / a.knownAtGeneration : 0;
      return { level, passageId: a.id, coverage: cover(a).coverage, stale: grown >= RUNG_STALE_GROWTH };
    });
    rungs.push({ level: "original", passageId: p.id, coverage: report.coverage, stale: false });
    const recommended = [...rungs].reverse().find((r) => r.passageId && (r.coverage ?? 0) >= RUNG_READABLE);
    return { passage: { id: p.id, title: p.title, reads: p.reads }, coverage: report.coverage, wordCount: report.wordCount, rungs, recommended };
  });
  const coverage = total === 0 ? 0 : known / total;

  const day = now.toISOString().slice(0, 10);
  await d.insert(goalCoverage).values({ goalId, day, coverage }).onConflictDoUpdate({ target: [goalCoverage.goalId, goalCoverage.day], set: { coverage } });

  let reached = goal.status === "reached";
  if (!reached && rows.length > 0 && coverage >= GOAL_REACHED && rows.every((p) => p.reads > 0)) {
    await d.update(goals).set({ status: "reached", reachedAt: now.toISOString() }).where(eq(goals.id, goalId));
    reached = true;
  }

  const unknown = goalUnknowns(rows, index.words);
  return {
    goal: reached ? { ...goal, status: "reached" } : goal,
    coverage,
    wordCount: total,
    unknownLemmas: unknown.length,
    queued: unknown.filter((u) => u.qualifies).length,
    knownAtoms: index.knownCount,
    sections,
    reached,
  };
}

export async function goalCoverageSeries(d: Db, goalId: string): Promise<Array<{ date: string; coverage: number }>> {
  const rows = await d.select().from(goalCoverage).where(eq(goalCoverage.goalId, goalId)).orderBy(asc(goalCoverage.day));
  return rows.map((r) => ({ date: r.day, coverage: r.coverage }));
}

/** Goal coverage a week ago (the latest logged point at least 7 days old), for "up 4 this week". */
export async function goalCoverageWeekAgo(d: Db, goalId: string, now = new Date()): Promise<number | undefined> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  return (await goalCoverageSeries(d, goalId)).filter((p) => p.date <= weekAgo).pop()?.coverage;
}

// ---- what the goal asks the learner to learn -------------------------------------------

interface GoalUnknown {
  lemma: string;
  count: number;
  atom?: AtomIndexRow;
  /** Worth a card: met more than once here, or common in French generally. One-off rarities are glossed in place. */
  qualifies: boolean;
}

function goalUnknowns(rows: PassageRow[], words: Map<string, AtomIndexRow>): GoalUnknown[] {
  const counts = new Map<string, number>();
  for (const p of rows) {
    for (const t of p.tokens) {
      if (!t.isWord || isKnownStatus(words.get(t.lemma)?.status)) continue;
      counts.set(t.lemma, (counts.get(t.lemma) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([lemma, count]) => {
      const atom = words.get(lemma);
      return { lemma, count, atom, qualifies: count >= GOAL_WORD_MIN_COUNT || (atom?.rank ?? null) !== null };
    })
    .sort((a, b) => b.count - a.count || (a.atom?.rank ?? 1e9) - (b.atom?.rank ?? 1e9));
}

/** The active goal's contribution to the scheduler's `newOrder`: its grammar, then its words by how often they occur in it. */
export async function goalNewOrder(d: Db): Promise<string[]> {
  const goal = await activeGoal(d);
  if (!goal) return [];
  const [index, rows] = await Promise.all([atomIndex(d), sectionRows(d, goal)]);
  const wordsInOrder = goalUnknowns(rows, index.words)
    .filter((u) => u.qualifies && u.atom && u.atom.status === "new" && u.atom.gloss.trim() !== "")
    .map((u) => u.atom!.id);
  return [...goal.grammarAtomIds, ...wordsInOrder];
}

/** Unknown goal lemmas for the scenario generator's candidate list, so the goal reaches back into the foundation. */
export async function goalLemmasForScenarios(d: Db, limit = 30): Promise<string[]> {
  const goal = await activeGoal(d);
  if (!goal) return [];
  const [index, rows] = await Promise.all([atomIndex(d), sectionRows(d, goal)]);
  return goalUnknowns(rows, index.words)
    .filter((u) => u.qualifies)
    .slice(0, limit)
    .map((u) => u.lemma);
}

// ---- preparing a goal (needs a model) ---------------------------------------------------

export type GlossFn = (items: GlossRequest[]) => Promise<Map<string, string>>;
export type SurveyFn = (input: SurveyInput) => Promise<Survey>;

/** How many goal words are glossed (and so made learnable) per call. */
export const GLOSS_BATCH = 120;
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Two model calls, run together: gloss the goal's qualifying words that have no
 * gloss yet (creating atoms for those outside the frequency list), and survey the
 * text for the grammar it leans on and for scenes worth practising.
 */
export async function prepareGoal(
  d: Db,
  goalId: string,
  fns: { gloss?: GlossFn; survey?: SurveyFn } = {},
  now = new Date(),
): Promise<{ glossed: number; grammar: number; scenes: number }> {
  const [goal] = await d.select().from(goals).where(eq(goals.id, goalId));
  if (!goal) throw new Error("unknown goal");
  const [index, rows] = await Promise.all([atomIndex(d), sectionRows(d, goal)]);
  const needGloss = goalUnknowns(rows, index.words)
    .filter((u) => u.qualifies && !(u.atom && u.atom.gloss.trim()))
    .slice(0, GLOSS_BATCH);
  const grammarRows = await d.select({ id: atoms.id, key: atoms.key, gloss: atoms.gloss, status: atoms.status }).from(atoms).where(eq(atoms.type, "grammar"));

  const [glosses, survey] = await Promise.all([
    needGloss.length ? (fns.gloss ?? glossLemmas)(needGloss.map((u) => ({ lemma: u.lemma }))) : new Map<string, string>(),
    goal.surveyedAt
      ? undefined
      : (fns.survey ?? surveyText)({
          title: goal.title,
          text: rows.map((r) => r.text).join("\n\n").split(/\s+/).slice(0, 1500).join(" "),
          grammar: grammarRows.map((g) => ({ key: g.key, gloss: g.gloss, known: isKnownStatus(g.status) })),
        }),
  ]);

  let glossed = 0;
  for (const u of needGloss) {
    const gloss = glosses.get(u.lemma);
    if (!gloss) continue;
    if (u.atom) await d.update(atoms).set({ gloss }).where(eq(atoms.id, u.atom.id));
    else await d.insert(atoms).values({ type: "word", key: u.lemma, forms: [u.lemma], gloss, source: "goal", status: "new" }).onConflictDoNothing();
    glossed++;
  }

  if (!survey) return { glossed, grammar: goal.grammarAtomIds.length, scenes: goal.sceneIdeas.length };
  const grammarAtomIds: string[] = [];
  for (const g of survey.grammar) {
    const key = slug(g.key);
    if (!key) continue;
    const existing = grammarRows.find((r) => r.key === key);
    if (existing) {
      if (existing.status === "new") grammarAtomIds.push(existing.id);
      continue;
    }
    const [row] = await d
      .insert(atoms)
      .values({ type: "grammar", key, forms: [], gloss: g.gloss.trim(), explanation: g.explanation.trim(), receptiveOnly: g.receptiveOnly, source: "goal", status: "new" })
      .returning({ id: atoms.id });
    grammarAtomIds.push(row.id);
  }
  await d.update(goals).set({ grammarAtomIds, sceneIdeas: survey.scenes, surveyedAt: now.toISOString() }).where(eq(goals.id, goalId));
  return { glossed, grammar: grammarAtomIds.length, scenes: survey.scenes.length };
}

/** Which rungs may be written today, and why not (SPEC §11 "The ladder"). */
export function rungGate(level: Level, knownAtoms: number, phase: "foundation" | "reading"): string | undefined {
  if (level === "gist") {
    return knownAtoms >= GIST_MIN_KNOWN ? undefined : `A summary you could read needs about ${GIST_MIN_KNOWN} known words; you have ${knownAtoms}.`;
  }
  return phase === "reading" ? undefined : `With ${knownAtoms} words, a rewrite would stop being this text. Rewrites open up once you're in the reading phase.`;
}
