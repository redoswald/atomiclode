import { normalizeForm } from "./lexicon";
import { analyzeLocal, type Token } from "./tokenize";

const patternCache = new Map<string, string[]>();

/**
 * Words of a chunk key, split exactly the way the tokenizer splits running text
 * (elisions, "excusez-moi", "est-ce", punctuation dropped), so the two can match.
 */
export function chunkPattern(key: string): string[] {
  let pattern = patternCache.get(key);
  if (!pattern) {
    pattern = analyzeLocal(key.toLowerCase())
      .tokens.filter((t) => t.isWord)
      .map((t) => normalizeForm(t.surface));
    patternCache.set(key, pattern);
  }
  return pattern;
}

/**
 * Dictionary match of chunk keys against consecutive word tokens within one
 * sentence. Longest match wins. Returns token index → chunk key.
 */
export function matchChunks(tokens: Token[], chunkKeys: string[]): Map<number, string> {
  const patterns = chunkKeys
    .map((key) => ({ key, words: chunkPattern(key) }))
    .filter((p) => p.words.length > 0)
    .sort((a, b) => b.words.length - a.words.length);
  const result = new Map<number, string>();
  const wordIdx = tokens.map((t, i) => (t.isWord ? i : -1)).filter((i) => i >= 0);
  const norm = wordIdx.map((i) => normalizeForm(tokens[i].surface));

  for (let w = 0; w < wordIdx.length; w++) {
    if (result.has(wordIdx[w])) continue;
    const sentence = tokens[wordIdx[w]].sentenceIdx;
    for (const p of patterns) {
      if (w + p.words.length > wordIdx.length) continue;
      let ok = true;
      for (let k = 0; k < p.words.length; k++) {
        const ti = wordIdx[w + k];
        if (norm[w + k] !== p.words[k] || tokens[ti].sentenceIdx !== sentence || result.has(ti)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (let k = 0; k < p.words.length; k++) result.set(wordIdx[w + k], p.key);
        break;
      }
    }
  }
  return result;
}
