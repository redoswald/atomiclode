/**
 * Passage library (SPEC §5): before generating, look for an existing passage
 * whose coverage against today's atoms falls in the requested band, that
 * contains some of `mustInclude`, roughly matches the genre, and hasn't been
 * read in the last 7 days. Generation is capped: one unread generated passage
 * at a time.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, passages } from "@/db/schema";
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

async function knownIndex(d: Db) {
  const rows = await d
    .select({ id: atoms.id, key: atoms.key, type: atoms.type, status: atoms.status, gloss: atoms.gloss })
    .from(atoms)
    .where(inArray(atoms.type, ["word", "chunk"]));
  const words = new Map<string, AtomLite>();
  const chunks = new Map<string, AtomLite>();
  for (const r of rows) (r.type === "chunk" ? chunks : words).set(r.key, r);
  return { words, chunks };
}

/** Find a passage to serve instead of generating. */
export async function findReusable(d: Db, req: LibraryRequest, now = new Date()): Promise<LibraryResult | undefined> {
  const index = await knownIndex(d);
  const rows = await d.select().from(passages).orderBy(desc(passages.createdAt));
  const cutoff = now.getTime() - REREAD_AFTER_DAYS * DAY_MS;
  let best: { id: string; coverage: number; score: number } | undefined;

  for (const p of rows) {
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
export async function unreadGenerated(d: Db): Promise<{ id: string; title: string | null } | undefined> {
  const [row] = await d
    .select({ id: passages.id, title: passages.title })
    .from(passages)
    .where(and(eq(passages.origin, "generated"), eq(passages.reads, 0)))
    .orderBy(desc(passages.createdAt))
    .limit(1);
  return row;
}

/** Serve a matching passage from the library, otherwise generate, store, and serve. */
export async function reuseOrGenerate(
  d: Db,
  req: LibraryRequest,
  generate: GenerateFn = generateWithModel,
  now = new Date(),
): Promise<LibraryResult> {
  const reusable = await findReusable(d, req, now);
  if (reusable) return reusable;

  const pending = await unreadGenerated(d);
  if (pending) {
    throw new Error(`Read "${pending.title ?? "your last generated passage"}" before generating another.`);
  }

  const index = await knownIndex(d);
  const known = [...index.words.values()].filter((a) => isKnownStatus(a.status)).map((a) => a.key);
  const chunks = [...index.chunks.values()].filter((a) => isKnownStatus(a.status)).map((a) => a.key);
  if (known.length < 20) {
    throw new Error("Learn a few more words first: generation needs at least 20 known words to work with.");
  }
  const recent = await d
    .select({ title: passages.title })
    .from(passages)
    .where(eq(passages.origin, "generated"))
    .orderBy(desc(passages.createdAt))
    .limit(5);

  const generated = await generate({
    known,
    chunks,
    targetCoverage: req.targetCoverage,
    genre: req.genre,
    topic: req.topic,
    mustInclude: req.mustInclude,
    avoidTitles: recent.map((r) => r.title).filter((t): t is string => Boolean(t)),
  });
  const { id } = await createPassage(d, { title: generated.title, text: generated.text, origin: "generated" });
  await d.update(passages).set({ genre: req.genre }).where(eq(passages.id, id));
  const [row] = await d.select({ coverage: passages.coverage }).from(passages).where(eq(passages.id, id));
  return { id, reused: false, coverage: row.coverage };
}

/** Lemmas of atoms due now, for `mustInclude` ("refresh inside reading"). */
export async function dueLemmas(d: Db, limit = 8, now = new Date()): Promise<string[]> {
  const rows = await d
    .select({ key: atoms.key })
    .from(atoms)
    .where(and(eq(atoms.type, "word"), inArray(atoms.status, ["learning", "review"]), sql`${atoms.due} <= ${now.toISOString()}`))
    .orderBy(atoms.due)
    .limit(limit);
  return rows.map((r) => r.key);
}
