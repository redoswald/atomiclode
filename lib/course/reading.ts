/**
 * Decodable (SPEC §17): the Latin reading a learner would produce by sounding a
 * Greek word out with the letters and rules taught so far. The validator
 * compares it with the seed's stored romanization; a mismatch means the word
 * can't be sounded out yet (a sight word, or it waits for its rule).
 *
 * The predictor follows the seed's romanization conventions, which spell
 * sounds but not every assimilation: σ stays "s" before voiced consonants
 * (λογαριασμό is "logariasmó"), so that rule isn't modelled.
 */
import { scriptUnits } from "@/lib/greek/script";
import type { SoundRule } from "./types";

const BASE: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m",
  ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", τ: "t", υ: "i", φ: "f", χ: "ch", ψ: "ps", ω: "o",
  ου: "ou", αι: "e", ει: "i", οι: "i", τσ: "ts", τζ: "tz", γγ: "ng",
};
/** b / d / g at the start of a word, mb / nd / ng inside it. */
const NASAL: Record<string, [string, string]> = { μπ: ["b", "mb"], ντ: ["d", "nd"], γκ: ["g", "ng"] };
/** ev / av, or ef / af before a voiceless consonant. */
const VOWEL_F: Record<string, [string, string]> = { ευ: ["ev", "ef"], αυ: ["av", "af"] };
const VOICELESS = new Set(["θ", "κ", "ξ", "π", "σ", "τ", "φ", "χ", "ψ", "τσ"]);
const VOWELS = new Set(["α", "ε", "η", "ι", "ο", "υ", "ω", "ου", "αι", "ει", "οι", "αυ", "ευ"]);
/** Units that start with a front vowel sound, before which γ is said "y". */
const FRONT = new Set(["ε", "ι", "η", "υ", "ει", "οι", "αι"]);

/** Lowercase, no accents or punctuation, single spaces: how readings are compared. */
export function plainReading(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The reading predicted for `text`, word by word, or undefined when it uses a
 * unit not in `known`.
 */
export function predictReading(text: string, known: Set<string>, rules: Set<SoundRule>): string | undefined {
  const out: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const units = scriptUnits(word);
    if (units.length === 0) continue;
    let s = "";
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!known.has(u)) return undefined;
      const next = units.at(i + 1);
      if (u === "γ" && next === "χ" && rules.has("gamma-chi")) s += "n";
      else if (u === "γ" && next && FRONT.has(next) && rules.has("gamma-front")) {
        s += "y";
        // γι / γει before another vowel is one sound, "y": γιατρός is yatrós, not yiatrós.
        const after = units.at(i + 2);
        if ((next === "ι" || next === "ει") && after && VOWELS.has(after)) i++;
      }
      // b / d / g at the start of a word, and after a nasal that already says the n or m
      // (πάρκινγκ is párking); mb / nd / ng elsewhere inside a word.
      else if (u in NASAL) s += NASAL[u][i === 0 || units.at(i - 1) === "ν" || units.at(i - 1) === "μ" ? 0 : 1];
      else if (u in VOWEL_F) s += VOWEL_F[u][next && VOICELESS.has(next) ? 1 : 0];
      else s += BASE[u] ?? "";
    }
    out.push(s);
  }
  return out.join(" ");
}

/** Does the predicted reading match the stored romanization (any of its "/" alternatives)? */
export function readingMatches(predicted: string, romanization: string): boolean {
  const p = plainReading(predicted).replace(/ /g, "");
  return romanization
    .split("/")
    .map((r) => plainReading(r).replace(/ /g, ""))
    .some((r) => r === p);
}
