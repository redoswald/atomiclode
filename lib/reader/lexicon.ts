import table from "./lexicon-fr.json";

/**
 * Attested form → lemma, from Lexique 3.83 (see db/seed/build-lexicon.py).
 * An empty value means the form is its own lemma.
 */
const LEXICON: Record<string, string> = table;

/** Lowercase, œ/æ folded to oe/ae, curly apostrophes straightened. */
export function normalizeForm(surface: string): string {
  return surface
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[’ʼ]/g, "'");
}

/** True when the form is attested in the lexicon. */
export function inLexicon(form: string): boolean {
  return form in LEXICON;
}

export function lemmatizeForm(form: string): string {
  return LEXICON[form] || form;
}
