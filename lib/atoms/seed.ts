/**
 * Turns the JSON files in db/seed/ into atom rows. Pure: no I/O, no DB.
 * The runner in db/seed/run.ts reads the files and writes the rows.
 * French words come from a frequency list; the Greek tourist curriculum is
 * hand-ordered, carries romanizations, and marks sign words receptive-only.
 */
import type { NewAtomRow } from "@/db/schema";
import type { Gender, Lang } from "@/lib/lang";

export interface WordEntry {
  rank: number;
  lemma: string;
  pos: string;
  gender: Gender | null;
  forms: string[];
  gloss: string;
  freqPerMillion?: number;
  romanization?: string;
  domains?: string[];
  /** Read it, never say it: recognize and cloze only (signs, letters). */
  receptiveOnly?: boolean;
}

/** @deprecated name kept for the French list; same shape. */
export type FrequencyEntry = WordEntry;

export interface ChunkEntry {
  key: string;
  gloss: string;
  words: string[]; // lemmas of the component words
  grammar: string[]; // grammar atom keys
  romanization?: string;
}

export interface GrammarEntry {
  key: string;
  gloss: string;
  explanation: string;
}

export function frequencyToRows(entries: WordEntry[], lang: Lang = "fr"): NewAtomRow[] {
  return entries.map((e) => ({
    lang,
    type: "word",
    key: e.lemma,
    forms: uniq([e.lemma, ...e.forms]),
    gloss: e.gloss ?? "",
    pos: e.pos,
    gender: e.gender ?? null,
    romanization: e.romanization ?? null,
    frequencyRank: e.rank,
    domains: e.domains ?? [],
    relatedAtoms: [],
    receptiveOnly: e.receptiveOnly ?? false,
    source: "frequency",
    status: "new",
  }));
}

export function chunksToRows(entries: ChunkEntry[], lang: Lang = "fr"): NewAtomRow[] {
  return entries.map((e) => ({
    lang,
    type: "chunk",
    key: e.key,
    forms: [e.key],
    gloss: e.gloss,
    romanization: e.romanization ?? null,
    domains: [],
    relatedAtoms: [], // linked to word/grammar atom ids after insert
    source: "frequency",
    status: "new",
  }));
}

export function grammarToRows(entries: GrammarEntry[], lang: Lang = "fr"): NewAtomRow[] {
  return entries.map((e) => ({
    lang,
    type: "grammar",
    key: e.key,
    forms: [],
    gloss: e.gloss,
    explanation: e.explanation,
    domains: [],
    relatedAtoms: [],
    source: "frequency",
    status: "new",
  }));
}

/**
 * Keys each chunk should be linked to, so the runner can resolve them to ids.
 * Returns chunk key → { words, grammar } with duplicates removed.
 */
export function chunkLinks(entries: ChunkEntry[]): Map<string, { words: string[]; grammar: string[] }> {
  return new Map(entries.map((e) => [e.key, { words: uniq(e.words), grammar: uniq(e.grammar) }]));
}

/** Basic sanity checks a seed file must pass before it is loaded. */
export function validateSeed(words: WordEntry[], chunks: ChunkEntry[], grammar: GrammarEntry[]): string[] {
  const problems: string[] = [];
  const dup = (xs: string[], label: string) => {
    const seen = new Set<string>();
    for (const x of xs) {
      if (seen.has(x)) problems.push(`duplicate ${label}: ${x}`);
      seen.add(x);
    }
  };
  dup(words.map((f) => f.lemma), "lemma");
  dup(chunks.map((c) => c.key), "chunk");
  dup(grammar.map((g) => g.key), "grammar key");

  const grammarKeys = new Set(grammar.map((g) => g.key));
  const lemmas = new Set(words.map((w) => w.lemma));
  for (const c of chunks) {
    for (const g of c.grammar) {
      if (!grammarKeys.has(g)) problems.push(`chunk "${c.key}" references unknown grammar "${g}"`);
    }
    for (const w of c.words) {
      if (!lemmas.has(w)) problems.push(`chunk "${c.key}" references unknown word "${w}"`);
    }
  }
  // Ranks must increase (gaps are fine: the Greek list leaves room between groups).
  words.forEach((f, i) => {
    if (i > 0 && f.rank <= words[i - 1].rank) problems.push(`rank out of order at ${f.lemma}: ${f.rank}`);
  });
  return problems;
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
