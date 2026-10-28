/**
 * Lenient answer matching for recall/cloze: ignores case, accents, leading
 * articles/clitics, and punctuation. "voudrais" ≈ "je voudrais" ≈ "Voudrais!"
 * Greek also accepts the romanization typed on a Latin keyboard: "efcharisto"
 * ≈ "ευχαριστώ", and the final sigma is folded.
 */
import type { Lang } from "@/lib/lang";

const ARTICLES_FR = /^(le|la|les|l|un|une|des|du|de la|de l|se|s|me|m|te|t|y|en|à|de)\s+/;
const ARTICLES_EL = /^(ο|η|το|οι|τα|τον|την|τη|ενασ|ενα|εναν|μια|μία|να|θα)\s+/;

export function normalizeAnswer(s: string, lang: Lang = "fr"): string {
  let t = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ς/g, "σ")
    .replace(/['’]/g, " ")
    .replace(lang === "el" ? /[^a-zα-ω\s-]/g : /[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const articles = lang === "el" ? ARTICLES_EL : ARTICLES_FR;
  // Strip one leading article/clitic at a time; "s il vous plait" keeps "il vous plait" etc.
  for (let i = 0; i < 2; i++) {
    const next = t.replace(articles, "");
    if (next === t) break;
    t = next;
  }
  return t;
}

/** Latin letters only, accents off, for comparing a typed romanization. */
export function normalizeRoman(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface MatchOptions {
  lang?: Lang;
  /** Accepted Latin-letter renderings (Greek). */
  romanizations?: string[];
}

export function lenientMatch(input: string, answers: string[], opts: MatchOptions = {}): boolean {
  const lang = opts.lang ?? "fr";
  const n = normalizeAnswer(input, lang);
  if (n && answers.some((a) => normalizeAnswer(a, lang) === n)) return true;
  if (opts.romanizations?.length) {
    const r = normalizeRoman(input);
    if (r && opts.romanizations.some((x) => romanVariants(x).includes(r))) return true;
  }
  return false;
}

/** "éxodos" matches "exodos"; "ch / h" style alternatives are split on the slash. */
function romanVariants(r: string): string[] {
  return r
    .split("/")
    .map((x) => normalizeRoman(x))
    .filter(Boolean);
}
