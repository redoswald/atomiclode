/**
 * How an atom is shown, in reviews and lessons alike: nouns with their article
 * (le marché, η έξοδος); a Greek letter as both cases ("Α α"); a sign word in
 * capitals, the way it is met. Pure, and safe in the browser.
 */
import { LANG_SPECS, type Gender, type Lang } from "@/lib/lang";

export interface Displayable {
  lang: Lang;
  type: "word" | "chunk" | "grammar";
  key: string;
  forms: string[];
  pos?: string;
  gender?: Gender;
  domains?: string[];
}

export function displayKey(a: Displayable): string {
  if (a.pos === "LETTER") {
    const letters = a.forms.filter((f) => f !== a.key);
    const upper = letters.filter((f) => f === f.toUpperCase());
    const lower = letters.filter((f) => f !== f.toUpperCase());
    return [...upper, ...lower].join(" ") || a.key.replace(/^letter:/, "");
  }
  if (a.type === "word" && a.domains?.includes("signs")) {
    const caps = a.forms.find((f) => f === f.toUpperCase() && f !== f.toLowerCase());
    if (caps) return caps;
  }
  if (a.type === "word" && a.pos === "NOUN" && a.gender) return `${LANG_SPECS[a.lang].article(a.key, a.gender)}${a.key}`;
  return a.key;
}
