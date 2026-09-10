/**
 * Passage persistence and the reader's view model. Analysis happens once at
 * import; coverage is recomputed against today's atoms every time a passage
 * is opened, so progress shows up on old passages too.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, encounters, passages, sentences, type PassageToken } from "@/db/schema";
import type { MemoryStatus, SentenceOrigin } from "@/lib/atoms/types";
import { knownMemoryState } from "@/lib/scheduler";
import { analyzeText, type AnalysisSource } from "./analyze";
import { computeCoverage, isKnownStatus, toPassageTokens, type AtomLite } from "./coverage";
import { normalizeForm } from "./lexicon";

export interface ViewToken extends PassageToken {
  /** Present when a word or chunk atom exists for this token. */
  atomId?: string;
  status?: MemoryStatus;
  gloss?: string;
  pos?: string;
  known: boolean;
}

export interface PassageView {
  id: string;
  title: string | null;
  origin: "imported" | "generated";
  sourceRef: string | null;
  sentences: string[];
  tokens: ViewToken[];
  coverage: number;
  wordCount: number;
  unknownCount: number;
  reads: number;
  lastReadAt: string | null;
}

export interface PassageSummary {
  id: string;
  title: string | null;
  origin: "imported" | "generated";
  sourceRef: string | null;
  coverage: number;
  reads: number;
  lastReadAt: string | null;
  createdAt: string;
  wordCount: number;
}

interface AtomIndex {
  words: Map<string, AtomLite>;
  chunks: Map<string, AtomLite>;
}

async function loadAtomIndex(d: Db): Promise<AtomIndex> {
  const rows = await d
    .select({ id: atoms.id, key: atoms.key, type: atoms.type, status: atoms.status, gloss: atoms.gloss, pos: atoms.pos })
    .from(atoms)
    .where(inArray(atoms.type, ["word", "chunk"]));
  const words = new Map<string, AtomLite>();
  const chunks = new Map<string, AtomLite>();
  for (const r of rows) (r.type === "chunk" ? chunks : words).set(r.key, r);
  return { words, chunks };
}

export interface CreatePassageInput {
  title?: string;
  text: string;
  origin: "imported" | "generated";
  sourceRef?: string;
}

export async function createPassage(d: Db, input: CreatePassageInput): Promise<{ id: string; source: AnalysisSource }> {
  const text = input.text.trim();
  if (text.length < 20) throw new Error("Paste at least a sentence or two.");
  if (text.length > 20_000) throw new Error("That's too long for one passage (20,000 characters max).");

  const index = await loadAtomIndex(d);
  const analysis = await analyzeText(text);
  const tokens = toPassageTokens(analysis.tokens, [...index.chunks.keys()]);
  const report = computeCoverage(tokens, (l) => index.words.get(l), (k) => index.chunks.get(k));
  const unknownAtomIds = report.unknownLemmas.map((l) => index.words.get(l)?.id).filter((x): x is string => Boolean(x));

  const [row] = await d
    .insert(passages)
    .values({
      title: input.title?.trim() || titleFrom(text),
      origin: input.origin,
      sourceRef: input.sourceRef ?? null,
      text,
      sentenceTexts: analysis.sentences,
      tokens,
      coverage: report.coverage,
      coverageAtGeneration: report.coverage,
      unknownAtoms: unknownAtomIds,
    })
    .returning({ id: passages.id });
  return { id: row.id, source: analysis.source };
}

function titleFrom(text: string): string {
  const first = text.split(/\n/)[0].trim();
  return first.length > 60 ? first.slice(0, 57).trimEnd() + "…" : first;
}

export async function listPassages(d: Db): Promise<PassageSummary[]> {
  const rows = await d
    .select({
      id: passages.id,
      title: passages.title,
      origin: passages.origin,
      sourceRef: passages.sourceRef,
      coverage: passages.coverage,
      reads: passages.reads,
      lastReadAt: passages.lastReadAt,
      createdAt: passages.createdAt,
      wordCount: sql<number>`(select count(*) from jsonb_array_elements(${passages.tokens}) t where (t->>'isWord')::boolean)::int`,
    })
    .from(passages)
    .orderBy(desc(passages.createdAt));
  return rows;
}

/** Load a passage for reading, refresh its coverage, and count the read. */
export async function openPassage(d: Db, id: string, now = new Date()): Promise<PassageView | undefined> {
  const [row] = await d.select().from(passages).where(eq(passages.id, id));
  if (!row) return undefined;
  const index = await loadAtomIndex(d);
  const report = computeCoverage(row.tokens, (l) => index.words.get(l), (k) => index.chunks.get(k));

  await d
    .update(passages)
    .set({ coverage: report.coverage, reads: row.reads + 1, lastReadAt: now.toISOString() })
    .where(eq(passages.id, id));
  if (report.knownAtomIds.length) {
    await d.insert(encounters).values(report.knownAtomIds.map((atomId) => ({ atomId, passageId: id, tapped: false, at: now.toISOString() })));
  }

  const tokens: ViewToken[] = row.tokens.map((t) => {
    if (!t.isWord) return { ...t, known: false };
    const chunk = t.chunkKey ? index.chunks.get(t.chunkKey) : undefined;
    if (chunk && isKnownStatus(chunk.status)) {
      return { ...t, atomId: chunk.id, status: chunk.status, gloss: chunk.gloss, known: true };
    }
    const atom = index.words.get(t.lemma);
    return atom
      ? { ...t, atomId: atom.id, status: atom.status, gloss: atom.gloss, pos: atom.pos ?? undefined, known: isKnownStatus(atom.status) }
      : { ...t, known: false };
  });

  return {
    id: row.id,
    title: row.title,
    origin: row.origin,
    sourceRef: row.sourceRef,
    sentences: row.sentenceTexts,
    tokens,
    coverage: report.coverage,
    wordCount: report.wordCount,
    unknownCount: report.unknownLemmas.length,
    reads: row.reads + 1,
    lastReadAt: now.toISOString(),
  };
}

/** Find or create the word atom for a lemma. Returns the row id and whether it was created. */
async function ensureWordAtom(
  d: Db,
  lemma: string,
  surface: string,
  gloss: string,
  source: "mined" | "manual",
): Promise<{ id: string; created: boolean; status: MemoryStatus }> {
  const key = normalizeForm(lemma);
  const form = normalizeForm(surface);
  const [existing] = await d.select().from(atoms).where(and(eq(atoms.type, "word"), eq(atoms.key, key)));
  if (existing) {
    const forms = existing.forms.includes(form) ? existing.forms : [...existing.forms, form];
    await d
      .update(atoms)
      .set({
        forms,
        gloss: existing.gloss || gloss,
        // A seeded word the learner met in text jumps the frequency queue.
        source: existing.status === "new" && existing.source === "frequency" ? "mined" : existing.source,
      })
      .where(eq(atoms.id, existing.id));
    return { id: existing.id, created: false, status: existing.status };
  }
  const [row] = await d
    .insert(atoms)
    .values({ type: "word", key, forms: Array.from(new Set([key, form])), gloss, source, status: "new" })
    .returning({ id: atoms.id });
  return { id: row.id, created: true, status: "new" };
}

export interface MineInput {
  passageId: string;
  sentenceIdx: number;
  lemma: string;
  surface: string;
  gloss: string;
}

/** SPEC §5 "Mine": create or link the atom and save the tapped sentence for cloze. */
export async function mineWord(d: Db, input: MineInput, now = new Date()): Promise<{ atomId: string; sentenceId: string }> {
  const [passage] = await d.select().from(passages).where(eq(passages.id, input.passageId));
  if (!passage) throw new Error("unknown passage");
  const text = passage.sentenceTexts[input.sentenceIdx];
  if (!text) throw new Error("unknown sentence");

  const atom = await ensureWordAtom(d, input.lemma, input.surface, input.gloss, "mined");

  // Every atom present in the sentence, known or not, so cloze/produce can use it later.
  const index = await loadAtomIndex(d);
  const atomIds = new Set<string>([atom.id]);
  for (const t of passage.tokens) {
    if (t.sentenceIdx !== input.sentenceIdx || !t.isWord) continue;
    const a = (t.chunkKey && index.chunks.get(t.chunkKey)) || index.words.get(t.lemma);
    if (a) atomIds.add(a.id);
  }

  const origin: SentenceOrigin = passage.origin === "generated" ? "generated" : "imported";
  const [existing] = await d
    .select({ id: sentences.id })
    .from(sentences)
    .where(and(eq(sentences.passageId, input.passageId), eq(sentences.passageIdx, input.sentenceIdx)));
  let sentenceId: string;
  if (existing) {
    await d.update(sentences).set({ atomIds: [...atomIds] }).where(eq(sentences.id, existing.id));
    sentenceId = existing.id;
  } else {
    const [row] = await d
      .insert(sentences)
      .values({
        text,
        atomIds: [...atomIds],
        origin,
        sourceRef: passage.sourceRef ?? undefined,
        passageId: input.passageId,
        passageIdx: input.sentenceIdx,
      })
      .returning({ id: sentences.id });
    sentenceId = row.id;
  }

  await d.insert(encounters).values({ atomId: atom.id, sentenceId, passageId: input.passageId, tapped: true, at: now.toISOString() });
  return { atomId: atom.id, sentenceId };
}

/** SPEC §5 "Already know": the atom starts (or restarts) with a mature memory state. */
export async function markKnown(d: Db, input: { lemma: string; surface: string; gloss: string }, now = new Date()): Promise<{ atomId: string }> {
  const atom = await ensureWordAtom(d, input.lemma, input.surface, input.gloss, "manual");
  const m = knownMemoryState(now.toISOString());
  await d
    .update(atoms)
    .set({
      stability: m.stability,
      difficulty: m.difficulty,
      due: m.due,
      lastReview: m.lastReview,
      reps: m.reps,
      lapses: m.lapses,
      status: m.status,
      learningSteps: m.learningSteps,
      scheduledDays: m.scheduledDays,
      markedKnownAt: now.toISOString(),
    })
    .where(eq(atoms.id, atom.id));
  return { atomId: atom.id };
}

/** Log a tap on a known atom (exposure signal for the scheduler, SPEC §4). */
export async function logTap(d: Db, atomId: string, passageId: string, now = new Date()): Promise<void> {
  await d.insert(encounters).values({ atomId, passageId, tapped: true, at: now.toISOString() });
}
