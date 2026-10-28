/**
 * Deterministic tokenizer + lookup lemmatizer, no external service. French and
 * Greek share the machinery; the language supplies its letters, capitals,
 * normalization and lexicon (see lib/lang.ts and ./lexicon.ts).
 * Sentences split on terminal punctuation (Greek asks with ";", which is also a
 * splitter there); French elisions (l', qu') and unknown hyphenations are split.
 * Concatenating `pre + surface` over all tokens reproduces the input exactly.
 */
import { CAPITALS, LETTERS, normalizeFor, type Lang } from "@/lib/lang";
import { lexiconFor, type Lexicon } from "./lexicon";

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

export interface AnalyzeOptions {
  lang?: Lang;
  lexicon?: Lexicon;
}

const WORD_RE: Record<Lang, RegExp> = {
  fr: new RegExp(`[${LETTERS.fr}]+(?:[’'\\-][${LETTERS.fr}]+)*[’']?`, "g"),
  el: new RegExp(`[${LETTERS.el}]+(?:[’'\\-][${LETTERS.el}]+)*[’']?`, "g"),
};
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
// The next sentence may open with a dialogue dash ("— Depuis hier.") or a quote.
// Greek uses ";" as its question mark and "·" as a semicolon.
const SENTENCE_END: Record<Lang, RegExp> = {
  fr: /([.!?…]+["»”’)]*)\s+(?=(?:[—–-]\s*)?["«“(]?\s*[A-ZÀ-ÖØ-Þ0-9])/g,
  el: /([.!?;…]+["»”’)]*)\s+(?=(?:[—–-]\s*)?["«“(]?\s*[A-ZÀ-ÖØ-ÞΑ-ΫΆΈ-ΊΌΎ-Ώ0-9])/g,
};
const SPLIT_MARK = "\u0000"; // never occurs in real text

/** Split text into sentences, keeping paragraph breaks as their own boundary. */
export function splitSentences(text: string, lang: Lang = "fr"): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    for (const s of trimmed.replace(SENTENCE_END[lang], `$1${SPLIT_MARK}`).split(SPLIT_MARK)) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

export function analyzeLocal(text: string, opts: AnalyzeOptions = {}): Analysis {
  const lang = opts.lang ?? "fr";
  const lexicon = lexiconFor(lang, opts.lexicon);
  const normalize = normalizeFor(lang);
  const normalized = text.replace(/\r\n?/g, "\n");
  const sentences = splitSentences(normalized, lang);
  const tokens: Token[] = [];
  let cursor = 0;

  sentences.forEach((sentence, sentenceIdx) => {
    // Locate this sentence in the original text so inter-sentence whitespace is preserved.
    const start = normalized.indexOf(sentence, cursor);
    const pre = normalized.slice(cursor, start);
    let gapCarry = pre;
    let inner = 0;
    let first = true;

    for (const m of sentence.matchAll(WORD_RE[lang])) {
      const at = m.index ?? 0;
      gapCarry = pushGap(tokens, gapCarry + sentence.slice(inner, at), sentenceIdx);
      const pieces = splitWord(m[0], lang, lexicon, normalize);
      pieces.forEach((piece, pi) => {
        if (piece === "-") {
          tokens.push({ pre: gapCarry, surface: piece, lemma: "", isWord: false, sentenceIdx });
          gapCarry = "";
          return;
        }
        const norm = normalize(piece);
        // A capital that isn't sentence-initial is a name (Marie, Λέσβος), not vocabulary.
        // All-caps Greek signage (ΕΞΟΔΟΣ, and the article Η inside it) is vocabulary: a word with no lowercase letter stays a word.
        const allCaps = piece === piece.toUpperCase() && piece !== piece.toLowerCase();
        const isName = !first && CAPITALS[lang].test(piece) && !allCaps;
        tokens.push({
          pre: gapCarry,
          surface: piece,
          lemma: isName ? piece : ((lang === "fr" ? elisionLemma(norm, pieces[pi + 1]) : undefined) ?? lexicon.lemmatize(piece)),
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
 * lexicon ("dis-moi" → "dis", "-", "moi"; "peut-être" stays whole). Greek has
 * no elisions worth splitting; hyphens there are rare and kept when attested.
 */
function splitWord(word: string, lang: Lang, lexicon: Lexicon, normalize: (s: string) => string): string[] {
  const norm = normalize(word);
  if (lexicon.has(word) && !FORCE_SPLIT.has(norm)) return [word];
  if (word.includes("-")) {
    const parts = word.split("-").filter(Boolean);
    if (parts.length > 1) {
      return parts.flatMap((p, i) => (i === 0 ? splitWord(p, lang, lexicon, normalize) : ["-", ...splitWord(p, lang, lexicon, normalize)]));
    }
  }
  if (lang === "fr") {
    for (const e of Object.keys(ELISIONS)) {
      if (norm.startsWith(e) && norm.length > e.length) {
        return [word.slice(0, e.length), ...splitWord(word.slice(e.length), lang, lexicon, normalize)];
      }
    }
  }
  return [word];
}

/** Lemma of an elided piece ("l'" → le). "s'" before il/ils is si, not se. */
function elisionLemma(norm: string, next: string | undefined): string | undefined {
  if (!(norm in ELISIONS)) return undefined;
  if (norm === "s'" && next && /^ils?$/i.test(normalizeFor("fr")(next))) return "si";
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
