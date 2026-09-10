/**
 * Lenient answer matching for recall/cloze: ignores case, accents, leading
 * articles/clitics, and punctuation. "voudrais" ≈ "je voudrais" ≈ "Voudrais!"
 */
const ARTICLES = /^(le|la|les|l|un|une|des|du|de la|de l|se|s|me|m|te|t|y|en|à|de)\s+/;

export function normalizeAnswer(s: string): string {
  let t = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/['’]/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Strip one leading article/clitic at a time; "s il vous plait" keeps "il vous plait" etc.
  for (let i = 0; i < 2; i++) {
    const next = t.replace(ARTICLES, "");
    if (next === t) break;
    t = next;
  }
  return t;
}

export function lenientMatch(input: string, answers: string[]): boolean {
  const n = normalizeAnswer(input);
  if (!n) return false;
  return answers.some((a) => normalizeAnswer(a) === n);
}
