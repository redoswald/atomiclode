/**
 * Lexicons: attested form → lemma. French ships a 125k-form table built from
 * Lexique 3.83 (db/seed/build-lexicon.py). Greek has no table of comparable
 * quality, so its lexicon is built at run time from the forms stored on the
 * learner's own atoms, which the tourist curriculum seeds generously; unseen
 * inflections fall back to the normalized surface form.
 */
import { type Lang, normalizeFor, normalizeFr } from "@/lib/lang";
import table from "./lexicon-fr.json";

export interface Lexicon {
  lang: Lang;
  /** True when the form (any case or accents) is attested. */
  has(form: string): boolean;
  /** Lemma for a surface form, as a normalized key; the normalized form itself when unknown. */
  lemmatize(form: string): string;
}

/** French table: an empty value means the form is its own lemma. */
const FR_TABLE: Record<string, string> = table;

export const frLexicon: Lexicon = {
  lang: "fr",
  has: (form) => normalizeFr(form) in FR_TABLE,
  lemmatize: (form) => {
    const n = normalizeFr(form);
    return FR_TABLE[n] || n;
  },
};

/** Lowercase with the final sigma folded but accents kept: "ή" (or) stays apart from "η" (the). */
const exactEl = (s: string) => s.toLowerCase().replace(/ς/g, "σ");

/**
 * Build a lexicon from atoms' forms. `normalize` must match the language's
 * tokenizer. A form is looked up with its accents first and accent-folded
 * second, so lowercase text keeps ή/η apart while a sign in capitals
 * (ΕΞΟΔΟΣ) still finds έξοδος.
 */
export function buildLexicon(lang: Lang, entries: Iterable<{ key: string; forms: string[] }>, normalize: (s: string) => string): Lexicon {
  const exact = new Map<string, string>();
  const folded = new Map<string, string>();
  const keyOf = lang === "el" ? exactEl : normalize;
  for (const e of entries) {
    // Multi-word keys (chunks) are matched as chunks, not lemmatized; namespaced
    // keys ("letter:η") are not words, and must not shadow the article η.
    if (e.key.includes(":")) continue;
    const lemma = normalize(e.key);
    if (/\s/.test(lemma)) continue;
    for (const f of [e.key, ...e.forms]) {
      if (/\s/.test(f.trim())) continue;
      const k = keyOf(f);
      const n = normalize(f);
      if (k && !exact.has(k)) exact.set(k, lemma);
      if (n && !folded.has(n)) folded.set(n, lemma);
    }
    // A word is always its own lemma, whatever an earlier entry listed it as a form of.
    exact.set(keyOf(e.key), lemma);
  }
  return {
    lang,
    has: (f) => exact.has(keyOf(f)) || folded.has(normalize(f)),
    lemmatize: (f) => exact.get(keyOf(f)) ?? folded.get(normalize(f)) ?? normalize(f),
  };
}

export const emptyLexicon = (lang: Lang): Lexicon => ({ lang, has: () => false, lemmatize: (f) => normalizeFor(lang)(f) });

export function lexiconFor(lang: Lang, provided?: Lexicon): Lexicon {
  if (provided) return provided;
  return lang === "fr" ? frLexicon : emptyLexicon(lang);
}

// ---- French-only helpers kept for existing callers ----------------------------

/** @deprecated use normalizeFor(lang) from lib/lang; this is the French rule. */
export const normalizeForm = normalizeFr;

/** @deprecated use lexiconFor(lang).has */
export function inLexicon(form: string): boolean {
  return frLexicon.has(form);
}

/** @deprecated use lexiconFor(lang).lemmatize */
export function lemmatizeForm(form: string): string {
  return frLexicon.lemmatize(form);
}
