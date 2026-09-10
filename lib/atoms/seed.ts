/**
 * Turns the JSON files in db/seed/ into atom rows. Pure: no I/O, no DB.
 * The runner in db/seed/index.ts reads the files and writes the rows.
 */
import type { NewAtomRow } from "@/db/schema";

export interface FrequencyEntry {
  rank: number;
  lemma: string;
  pos: string;
  gender: "m" | "f" | null;
  forms: string[];
  freqPerMillion: number;
  gloss: string;
}

export interface ChunkEntry {
  key: string;
  gloss: string;
  words: string[]; // lemmas of the component words
  grammar: string[]; // grammar atom keys
}

export interface GrammarEntry {
  key: string;
  gloss: string;
  explanation: string;
}

export function frequencyToRows(entries: FrequencyEntry[]): NewAtomRow[] {
  return entries.map((e) => ({
    lang: "fr",
    type: "word",
    key: e.lemma,
    forms: uniq([e.lemma, ...e.forms]),
    gloss: e.gloss ?? "",
    pos: e.pos,
    gender: e.gender ?? null,
    frequencyRank: e.rank,
    domains: [],
    relatedAtoms: [],
    source: "frequency",
    status: "new",
  }));
}

export function chunksToRows(entries: ChunkEntry[]): NewAtomRow[] {
  return entries.map((e) => ({
    lang: "fr",
    type: "chunk",
    key: e.key,
    forms: [e.key],
    gloss: e.gloss,
    domains: [],
    relatedAtoms: [], // linked to word/grammar atom ids after insert
    source: "frequency",
    status: "new",
  }));
}

export function grammarToRows(entries: GrammarEntry[]): NewAtomRow[] {
  return entries.map((e) => ({
    lang: "fr",
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
export function validateSeed(freq: FrequencyEntry[], chunks: ChunkEntry[], grammar: GrammarEntry[]): string[] {
  const problems: string[] = [];
  const dup = (xs: string[], label: string) => {
    const seen = new Set<string>();
    for (const x of xs) {
      if (seen.has(x)) problems.push(`duplicate ${label}: ${x}`);
      seen.add(x);
    }
  };
  dup(freq.map((f) => f.lemma), "lemma");
  dup(chunks.map((c) => c.key), "chunk");
  dup(grammar.map((g) => g.key), "grammar key");

  const grammarKeys = new Set(grammar.map((g) => g.key));
  for (const c of chunks) {
    for (const g of c.grammar) {
      if (!grammarKeys.has(g)) problems.push(`chunk "${c.key}" references unknown grammar "${g}"`);
    }
  }
  freq.forEach((f, i) => {
    if (f.rank !== i + 1) problems.push(`rank out of order at ${f.lemma}: ${f.rank}`);
  });
  return problems;
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
