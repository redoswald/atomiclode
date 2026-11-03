/**
 * Passage library (SPEC §5): before generating, look for an existing passage
 * whose coverage against today's atoms falls in the requested band, that
 * contains some of `mustInclude`, roughly matches the genre, and hasn't been
 * read in the last 7 days. Generation is capped: one unread generated passage
 * at a time.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { isLang, type Lang } from "@/lib/lang";
import type { Learner } from "@/lib/learners/provision";
import { atoms, passages } from "@/db/schema";
import { adaptText as adaptWithModel, type AdaptInput, type Level } from "@/lib/llm/adapt";
import { generatePassage as generateWithModel, type GenerateInput, type GeneratedPassage, type Genre } from "@/lib/llm/generate";
import { computeCoverage, isKnownStatus, type AtomLite } from "./coverage";
import { createPassage } from "./passages";

export interface LibraryRequest {
  targetCoverage: number; // 0.90–0.98
  genre: Genre;
  topic?: string;
  mustInclude: string[]; // lemmas
}

export interface LibraryResult {
  id: string;
  reused: boolean;
  coverage: number;
}

export type GenerateFn = (input: GenerateInput) => Promise<GeneratedPassage>;

const DAY_MS = 86_400_000;
/** Coverage band around the target that counts as a match. */
export const BAND_BELOW = 0.04;
export const BAND_ABOVE = 0.02;
export const REREAD_AFTER_DAYS = 7;
/** Genre tag on the section passages of a goal text; they live on the goal page, not in the library list. */
export const GOAL_SECTION_GENRE = "goal-section";

async function knownIndex(d: Db, me: Learner) {
  const rows = await d
    .select({ id: atoms.id, key: atoms.key, type: atoms.type, status: atoms.status, gloss: atoms.gloss })
    .from(atoms)
    .where(and(eq(atoms.userId, me.userId), eq(atoms.lang, me.lang), inArray(atoms.type, ["word", "chunk"])));
  const words = new Map<string, AtomLite>();
  const chunks = new Map<string, AtomLite>();
  for (const r of rows) (r.type === "chunk" ? chunks : words).set(r.key, r);
  return { words, chunks };
}

/** Find a passage to serve instead of generating. */
export async function findReusable(d: Db, me: Learner, req: LibraryRequest, now = new Date()): Promise<LibraryResult | undefined> {
  const index = await knownIndex(d, me);
  const rows = await d
    .select()
    .from(passages)
    .where(and(eq(passages.userId, me.userId), eq(passages.lang, me.lang)))
    .orderBy(desc(passages.createdAt));
  const cutoff = now.getTime() - REREAD_AFTER_DAYS * DAY_MS;
  let best: { id: string; coverage: number; score: number } | undefined;

  for (const p of rows) {
    if (p.origin === "scenario" || p.genre === GOAL_SECTION_GENRE) continue;
    if (p.lastReadAt && new Date(p.lastReadAt).getTime() > cutoff) continue;
    const report = computeCoverage(p.tokens, (l) => index.words.get(l), (k) => index.chunks.get(k));
    if (report.coverage < req.targetCoverage - BAND_BELOW || report.coverage > req.targetCoverage + BAND_ABOVE) continue;
    const lemmas = new Set(p.tokens.filter((t) => t.isWord).map((t) => t.lemma));
    const hits = req.mustInclude.filter((m) => lemmas.has(m)).length;
    if (req.mustInclude.length > 0 && hits === 0) continue;
    const genreScore = p.genre === req.genre ? 1 : p.genre ? 0 : 0.5;
    const score = hits * 2 + genreScore - Math.abs(report.coverage - req.targetCoverage) * 10;
    if (!best || score > best.score) best = { id: p.id, coverage: report.coverage, score };
  }
  return best ? { id: best.id, coverage: best.coverage, reused: true } : undefined;
}

/** The one-generation-per-session cap: an unread generated passage blocks a new one. */
export async function unreadGenerated(d: Db, me: Learner): Promise<{ id: string; title: string | null } | undefined> {
  const [row] = await d
    .select({ id: passages.id, title: passages.title })
    .from(passages)
    .where(and(eq(passages.userId, me.userId), eq(passages.lang, me.lang), eq(passages.origin, "generated"), eq(passages.reads, 0), sql`coalesce(${passages.sourceRef}, '') not like 'passage:%'`))
    .orderBy(desc(passages.createdAt))
    .limit(1);
  return row;
}

/** Serve a matching passage from the library, otherwise generate, store, and serve. */
export async function reuseOrGenerate(
  d: Db,
  me: Learner,
  req: LibraryRequest,
  generate: GenerateFn = generateWithModel,
  now = new Date(),
): Promise<LibraryResult> {
  const reusable = await findReusable(d, me, req, now);
  if (reusable) return reusable;

  const { lang } = me;
  const pending = await unreadGenerated(d, me);
  if (pending) {
    throw new Error(`Read "${pending.title ?? "your last generated passage"}" before generating another.`);
  }

  const index = await knownIndex(d, me);
  const known = [...index.words.values()].filter((a) => isKnownStatus(a.status)).map((a) => a.key);
  const chunks = [...index.chunks.values()].filter((a) => isKnownStatus(a.status)).map((a) => a.key);
  if (known.length < 20) {
    throw new Error("Learn a few more words first: generation needs at least 20 known words to work with.");
  }
  const recent = await d
    .select({ title: passages.title })
    .from(passages)
    .where(and(eq(passages.userId, me.userId), eq(passages.lang, lang), eq(passages.origin, "generated")))
    .orderBy(desc(passages.createdAt))
    .limit(5);

  const generated = await generate({
    lang,
    known,
    chunks,
    targetCoverage: req.targetCoverage,
    genre: req.genre,
    topic: req.topic,
    mustInclude: req.mustInclude,
    avoidTitles: recent.map((r) => r.title).filter((t): t is string => Boolean(t)),
  });
  const { id } = await createPassage(d, me.userId, { lang, title: generated.title, text: generated.text, origin: "generated" });
  await d.update(passages).set({ genre: req.genre }).where(eq(passages.id, id));
  const [row] = await d.select({ coverage: passages.coverage }).from(passages).where(eq(passages.id, id));
  return { id, reused: false, coverage: row.coverage };
}

/** Lemmas of atoms due now, for `mustInclude` ("refresh inside reading"). */
export async function dueLemmas(d: Db, me: Learner, limit = 8, now = new Date()): Promise<string[]> {
  const rows = await d
    .select({ key: atoms.key })
    .from(atoms)
    .where(and(eq(atoms.userId, me.userId), eq(atoms.lang, me.lang), eq(atoms.type, "word"), inArray(atoms.status, ["learning", "review"]), sql`${atoms.due} <= ${now.toISOString()}`))
    .orderBy(atoms.due)
    .limit(limit);
  return rows.map((r) => r.key);
}

export type AdaptFn = (input: AdaptInput) => Promise<{ title: string; text: string }>;

/**
 * "Adapt this text": rewrite an existing passage at a target coverage, keeping
 * the meaning. The adaptation is a generated passage that points back to the
 * original through sourceRef ("passage:<id>"), and is reused if it already exists.
 */
export async function adaptPassage(
  d: Db,
  userId: string,
  passageId: string,
  level: Level,
  adapt: AdaptFn = adaptWithModel,
  opts: { refresh?: boolean } = {},
): Promise<LibraryResult> {
  const [original] = await d.select().from(passages).where(and(eq(passages.id, passageId), eq(passages.userId, userId)));
  if (!original) throw new Error("unknown passage");
  const ref = `passage:${passageId}#${level}`;
  const [existing] = await d
    .select({ id: passages.id, coverage: passages.coverage })
    .from(passages)
    .where(and(eq(passages.userId, userId), eq(passages.sourceRef, ref)))
    .orderBy(desc(passages.createdAt))
    .limit(1);
  // `refresh` rewrites a rung the learner has outgrown; the old one stays in the library.
  if (existing && !opts.refresh) return { id: existing.id, coverage: existing.coverage, reused: true };

  const lang: Lang = isLang(original.lang) ? original.lang : "fr";
  const index = await knownIndex(d, { userId, lang });
  const known = [...index.words.values()].filter((a) => isKnownStatus(a.status)).map((a) => a.key);
  const chunks = [...index.chunks.values()].filter((a) => isKnownStatus(a.status)).map((a) => a.key);
  if (known.length < 20) {
    throw new Error("Learn a few more words first: adapting needs at least 20 known words to work with.");
  }
  const adapted = await adapt({ lang, text: original.text, title: original.title ?? undefined, known, chunks, level });
  const { id } = await createPassage(d, userId, { lang, title: adapted.title, text: adapted.text, origin: "generated", sourceRef: ref });
  await d.update(passages).set({ genre: original.genre && original.genre !== GOAL_SECTION_GENRE ? original.genre : "adapted", knownAtGeneration: known.length }).where(eq(passages.id, id));
  const [row] = await d.select({ coverage: passages.coverage }).from(passages).where(eq(passages.id, id));
  return { id, reused: false, coverage: row.coverage };
}

/** Existing adaptations of a passage, by level (the most recent of each). */
export async function adaptationsOf(d: Db, userId: string, passageId: string): Promise<Partial<Record<Level, string>>> {
  const rows = await d
    .select({ id: passages.id, sourceRef: passages.sourceRef })
    .from(passages)
    .where(and(eq(passages.userId, userId), sql`${passages.sourceRef} like ${`passage:${passageId}#%`}`))
    .orderBy(passages.createdAt);
  const out: Partial<Record<Level, string>> = {};
  for (const r of rows) {
    const level = r.sourceRef?.split("#")[1] as Level | undefined;
    if (level) out[level] = r.id;
  }
  return out;
}
