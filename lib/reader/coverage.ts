/**
 * Coverage: the fraction of word tokens whose atom the learner knows.
 * "Known" means the atom is in learning or review; seeded-but-unlearned atoms
 * (status new) and words with no atom at all are unknown alike.
 */
import type { PassageToken } from "@/db/schema";
import type { MemoryStatus } from "@/lib/atoms/types";
import { matchChunks } from "./chunks";
import type { Token } from "./tokenize";

export interface AtomLite {
  id: string;
  key: string;
  status: MemoryStatus;
  gloss: string;
}

export interface CoverageReport {
  coverage: number; // 0–1
  wordCount: number;
  knownCount: number;
  /** Distinct lemmas of unknown word tokens, in order of first appearance. */
  unknownLemmas: string[];
  /** Distinct known atom ids present (for exposure logging). */
  knownAtomIds: string[];
}

export function isKnownStatus(status: MemoryStatus | undefined): boolean {
  return status === "learning" || status === "review";
}

/** Attach chunk keys to analysed tokens so they can be stored on the passage. */
export function toPassageTokens(tokens: Token[], chunkKeys: string[]): PassageToken[] {
  const chunks = matchChunks(tokens, chunkKeys);
  return tokens.map((t, i) => {
    const chunkKey = chunks.get(i);
    return {
      pre: t.pre,
      surface: t.surface,
      lemma: t.lemma,
      isWord: t.isWord,
      sentenceIdx: t.sentenceIdx,
      ...(chunkKey ? { chunkKey } : {}),
    };
  });
}

export function computeCoverage(
  tokens: PassageToken[],
  wordAtom: (lemma: string) => AtomLite | undefined,
  chunkAtom: (key: string) => AtomLite | undefined,
): CoverageReport {
  let wordCount = 0;
  let knownCount = 0;
  const unknown = new Set<string>();
  const known = new Set<string>();
  for (const t of tokens) {
    if (!t.isWord) continue;
    wordCount++;
    const chunk = t.chunkKey ? chunkAtom(t.chunkKey) : undefined;
    if (chunk && isKnownStatus(chunk.status)) {
      knownCount++;
      known.add(chunk.id);
      continue;
    }
    const atom = wordAtom(t.lemma);
    if (atom && isKnownStatus(atom.status)) {
      knownCount++;
      known.add(atom.id);
    } else {
      unknown.add(t.lemma);
    }
  }
  return {
    coverage: wordCount === 0 ? 1 : knownCount / wordCount,
    wordCount,
    knownCount,
    unknownLemmas: [...unknown],
    knownAtomIds: [...known],
  };
}
