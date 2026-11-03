/**
 * Greek script (SPEC §16): a word's script units (letters and letter
 * combinations), and the lookalike letters that read as a different Latin
 * letter. Pure, and safe in the browser.
 */

/** Two-letter units, matched before single letters. Each has a `letter:` atom in the seed. */
export const COMBINATIONS = ["ου", "αι", "ει", "οι", "μπ", "ντ", "γκ", "γγ", "αυ", "ευ", "τσ", "τζ"] as const;

const LETTERS = new Set("αβγδεζηθικλμνξοπρστυφχψω");
const COMBO_SET = new Set<string>(COMBINATIONS);

/** The atom key for a unit: `letter:ρ`, `letter:ου`. */
export const letterKey = (unit: string) => `letter:${unit}`;

/**
 * The units of a word or phrase, in order: lowercase, accents off, ς read as σ,
 * combinations first. A diaeresis splits a combination (κοροϊδεύω: ο, ι, not οι).
 * Anything that isn't a Greek letter (spaces, Latin, punctuation) is skipped.
 */
export function scriptUnits(text: string): string[] {
  const chars: Array<{ c: string; split: boolean }> = [];
  for (const ch of text.toLowerCase().normalize("NFD")) {
    if (ch === "̈") {
      if (chars.length) chars[chars.length - 1].split = true;
      continue;
    }
    if (/\p{M}/u.test(ch)) continue;
    const c = ch === "ς" ? "σ" : ch;
    chars.push({ c, split: false });
  }
  const units: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const { c } = chars[i];
    if (!LETTERS.has(c)) continue;
    const next = chars[i + 1];
    if (next && !next.split && COMBO_SET.has(c + next.c)) {
      units.push(c + next.c);
      i++;
      continue;
    }
    units.push(c);
  }
  return units;
}

/** Distinct units, for "which of these do I know?". */
export function unitSet(text: string): Set<string> {
  return new Set(scriptUnits(text));
}

/**
 * Letters that look like a Latin letter and say something else. `looks` is the
 * Latin letter a newcomer reads; `says` is what it is. Capitals and lowercase
 * mislead differently, so both are listed.
 */
export const LOOKALIKES: Record<string, { looks: string; says: string }> = {
  Η: { looks: "H", says: "i" },
  Ρ: { looks: "P", says: "r" },
  Χ: { looks: "X", says: "ch" },
  Υ: { looks: "Y", says: "i" },
  Β: { looks: "B", says: "v" },
  ν: { looks: "v", says: "n" },
  η: { looks: "n", says: "i" },
  ρ: { looks: "p", says: "r" },
  υ: { looks: "u", says: "i" },
};

/** The letter atoms flagged `lookalike` in the seed. */
export const LOOKALIKE_LETTERS = ["letter:η", "letter:ρ", "letter:χ", "letter:ν", "letter:υ", "letter:β"];

/**
 * When a decode answer went wrong because a letter was read as its Latin
 * lookalike (ΜΕΤΡΟ typed as "metpo"), the letter that misled. Heuristic: the
 * typed answer contains the lookalike's Latin letter and the right reading doesn't.
 */
export function lookalikeMisread(shown: string, typed: string, romanization: string): { letter: string; looks: string; says: string } | undefined {
  const t = typed.toLowerCase();
  const r = romanization.toLowerCase();
  for (const ch of shown) {
    const l = LOOKALIKES[ch];
    if (!l) continue;
    const latin = l.looks.toLowerCase();
    if (t.includes(latin) && !r.includes(latin)) return { letter: ch, ...l };
  }
  return undefined;
}
