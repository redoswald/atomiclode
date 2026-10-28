/**
 * Languages the app teaches. One learner, several tracks: every atom, passage,
 * scenario, and goal carries a `lang`, and the current track is a cookie.
 * Everything language-specific that code needs lives in this registry.
 */
export type Lang = "fr" | "el";
export const LANGS: readonly Lang[] = ["fr", "el"];
export const DEFAULT_LANG: Lang = "fr";
export const LANG_COOKIE = "lode_lang";

export type Gender = "m" | "f" | "n";

export interface LangSpec {
  code: Lang;
  /** English name, as in "French · Day 6". */
  name: string;
  /** How the language names itself, for the switcher. */
  nativeName: string;
  /** Definite article to show before a noun of this gender, or "" when none applies. */
  article(key: string, gender?: Gender): string;
  /** Placeholder for a typed answer. */
  typePlaceholder: string;
  /** Learners can type answers in Latin letters that are matched against the romanization. */
  acceptsRomanizedAnswers: boolean;
  /** Has the 3000-lemma frequency list (and so a corpus-weighted coverage figure). */
  hasFrequencyList: boolean;
  /** Short note for the model on the variety to write. */
  modelNote: string;
  /** Fallback passage title. */
  untitled: string;
  /** Placeholder for the paste box on /read. */
  pastePlaceholder: string;
  /** Example topics for "Generate". */
  topicExample: string;
  /** Example custom scene. */
  scenePlaceholder: string;
}

const VOWEL_START_FR = /^[aeiouyâàéèêëîïôöûüœh]/i;

export const LANG_SPECS: Record<Lang, LangSpec> = {
  fr: {
    code: "fr",
    name: "French",
    nativeName: "Français",
    article: (key, gender) => (gender === "m" || gender === "f" ? (VOWEL_START_FR.test(key) ? "l'" : gender === "m" ? "le " : "la ") : ""),
    typePlaceholder: "En français…",
    acceptsRomanizedAnswers: false,
    hasFrequencyList: true,
    modelNote: "Standard metropolitan French.",
    untitled: "Sans titre",
    pastePlaceholder: "Collez un texte en français…",
    topicExample: "un marché à Lyon, mon trajet en train…",
    scenePlaceholder: "Meeting her grandmother on Sunday. She speaks no English and loves her garden.",
  },
  el: {
    code: "el",
    name: "Greek",
    nativeName: "Ελληνικά",
    article: (_key, gender) => (gender === "m" ? "ο " : gender === "f" ? "η " : gender === "n" ? "το " : ""),
    typePlaceholder: "Στα ελληνικά… (or in Latin letters)",
    acceptsRomanizedAnswers: true,
    hasFrequencyList: false,
    modelNote: "Standard Modern Greek (δημοτική) with monotonic accents; the everyday, spoken register a visitor meets.",
    untitled: "Χωρίς τίτλο",
    pastePlaceholder: "Επικολλήστε ένα ελληνικό κείμενο… (a menu, a sign, a ferry notice)",
    topicExample: "a taverna in Naxos, the ferry to Paros…",
    scenePlaceholder: "Renting a scooter in Paros. The owner wants a deposit and my passport.",
  },
};

export function isLang(v: unknown): v is Lang {
  return v === "fr" || v === "el";
}

export function langName(lang: Lang): string {
  return LANG_SPECS[lang].name;
}

// ---- normalization -------------------------------------------------------------
// Shared by the tokenizer, chunk matching, answer checking and the gap finder, so
// that ΕΞΟΔΟΣ on a sign, έξοδος in a text, and "exodos" typed on a Latin keyboard
// all meet in the middle.

/** Lowercase, œ/æ folded, curly apostrophes straightened. Accents kept. */
export function normalizeFr(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[’ʼ]/g, "'");
}

/**
 * Lowercase, tonos and dialytika removed, final sigma folded. Signs are set in
 * capitals without accents, so accents cannot be part of identity in Greek.
 */
export function normalizeEl(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[’ʼ]/g, "'");
}

export function normalizeFor(lang: Lang): (s: string) => string {
  return lang === "el" ? normalizeEl : normalizeFr;
}

/** Strip accents for loose comparisons (both languages). */
export function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Letters of the language, for word-token matching. */
export const LETTERS: Record<Lang, string> = {
  fr: "a-zA-ZÀ-ÖØ-öø-ÿœŒæÆ",
  el: "a-zA-ZÀ-ÖØ-öø-ÿœŒæÆͰ-Ͽἀ-῿",
};

/** Capital letters that start a sentence or a name. */
export const CAPITALS: Record<Lang, RegExp> = {
  fr: /^[A-ZÀ-ÖØ-Þ]/,
  el: /^[A-ZÀ-ÖØ-ÞΑ-ΫΆΈ-ΊΌΎ-Ώ]/,
};
