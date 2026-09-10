/**
 * Deterministic French tokenizer + lookup lemmatizer, no external service.
 * Sentences are split on terminal punctuation; words are lemmatized through
 * the Lexique table; elisions (l', qu') and unknown hyphenations are split.
 * Concatenating `pre + surface` over all tokens reproduces the input exactly.
 */
import { inLexicon, lemmatizeForm, normalizeForm } from "./lexicon";

export interface Token {
  pre: string; // whitespace before the token
  surface: string;
  lemma: string;
  isWord: boolean;
  sentenceIdx: number;
}

export interface Analysis {
  sentences: string[];
  tokens: Token[];
}

const LETTER = "a-zA-ZÀ-ÖØ-öø-ÿœŒæÆ";
const WORD_RE = new RegExp(`[${LETTER}]+(?:[’'\\-][${LETTER}]+)*[’']?`, "g");
const ELISIONS: Record<string, string> = {
  "jusqu'": "jusque",
  "lorsqu'": "lorsque",
  "puisqu'": "puisque",
  "quoiqu'": "quoique",
  "qu'": "que",
  "l'": "le",
  "d'": "de",
  "j'": "je",
  "n'": "ne",
  "m'": "me",
  "t'": "te",
  "s'": "se",
  "c'": "ce",
};
/** Lexicon entries that are really verb–pronoun joins and should still split. */
const FORCE_SPLIT = new Set(["est-ce", "pas-je"]);
const SENTENCE_END = /([.!?…]+["»”’)]*)\s+(?=["«“(]?[A-ZÀ-ÖØ-Þ0-9])/g;
const SPLIT_MARK = "\u0000"; // never occurs in real text

/** Split text into sentences, keeping paragraph breaks as their own boundary. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    for (const s of trimmed.replace(SENTENCE_END, `$1${SPLIT_MARK}`).split(SPLIT_MARK)) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

export function analyzeLocal(text: string): Analysis {
  const normalized = text.replace(/\r\n?/g, "\n");
  const sentences = splitSentences(normalized);
  const tokens: Token[] = [];
  let cursor = 0;

  sentences.forEach((sentence, sentenceIdx) => {
    // Locate this sentence in the original text so inter-sentence whitespace is preserved.
    const start = normalized.indexOf(sentence, cursor);
    const pre = normalized.slice(cursor, start);
    let gapCarry = pre;
    let inner = 0;
    let first = true;

    for (const m of sentence.matchAll(WORD_RE)) {
      const at = m.index ?? 0;
      gapCarry = pushGap(tokens, gapCarry + sentence.slice(inner, at), sentenceIdx);
      const pieces = splitWord(m[0]);
      pieces.forEach((piece, pi) => {
        if (piece === "-") {
          tokens.push({ pre: gapCarry, surface: piece, lemma: "", isWord: false, sentenceIdx });
          gapCarry = "";
          return;
        }
        const norm = normalizeForm(piece);
        // A capital that isn't sentence-initial is a name (Marie, Lyon), not vocabulary.
        const isName = !first && /^[A-ZÀ-ÖØ-Þ]/.test(piece);
        tokens.push({
          pre: gapCarry,
          surface: piece,
          lemma: isName ? piece : elisionLemma(norm, pieces[pi + 1]) ?? lemmatizeForm(norm),
          isWord: !isName,
          sentenceIdx,
        });
        gapCarry = "";
        first = false;
      });
      inner = at + m[0].length;
    }
    gapCarry = pushGap(tokens, gapCarry + sentence.slice(inner), sentenceIdx);
    if (gapCarry) tokens.push({ pre: gapCarry, surface: "", lemma: "", isWord: false, sentenceIdx });
    cursor = start + sentence.length;
  });

  const tail = normalized.slice(cursor);
  if (tail) tokens.push({ pre: tail, surface: "", lemma: "", isWord: false, sentenceIdx: sentences.length - 1 });
  return { sentences, tokens: tokens.filter((t) => t.surface !== "" || t.pre !== "") };
}

/**
 * Split elisions ("l'homme" → "l'", "homme") and hyphen compounds not in the
 * lexicon ("dis-moi" → "dis", "-", "moi"; "peut-être" stays whole).
 */
function splitWord(word: string): string[] {
  const norm = normalizeForm(word);
  if (inLexicon(norm) && !FORCE_SPLIT.has(norm)) return [word];
  if (word.includes("-")) {
    const parts = word.split("-").filter(Boolean);
    if (parts.length > 1) return parts.flatMap((p, i) => (i === 0 ? splitWord(p) : ["-", ...splitWord(p)]));
  }
  for (const e of Object.keys(ELISIONS)) {
    if (norm.startsWith(e) && norm.length > e.length) {
      return [word.slice(0, e.length), ...splitWord(word.slice(e.length))];
    }
  }
  return [word];
}

/** Lemma of an elided piece ("l'" → le). "s'" before il/ils is si, not se. */
function elisionLemma(norm: string, next: string | undefined): string | undefined {
  if (!(norm in ELISIONS)) return undefined;
  if (norm === "s'" && next && /^ils?$/i.test(normalizeForm(next))) return "si";
  return ELISIONS[norm];
}

/**
 * Emit punctuation in `gap` as non-word tokens. Returns trailing whitespace,
 * which becomes the `pre` of whatever comes next.
 */
function pushGap(tokens: Token[], gap: string, sentenceIdx: number): string {
  if (!gap) return "";
  const lead = gap.match(/^\s*/)![0];
  const rest = gap.slice(lead.length);
  if (!rest) return lead;
  const trail = rest.match(/\s*$/)![0];
  tokens.push({ pre: lead, surface: rest.slice(0, rest.length - trail.length), lemma: "", isWord: false, sentenceIdx });
  return trail;
}

/** Word tokens only. */
export function wordTokens(tokens: Token[]): Token[] {
  return tokens.filter((t) => t.isWord);
}
