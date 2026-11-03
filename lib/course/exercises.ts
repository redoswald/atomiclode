/**
 * A lesson's practice (SPEC §17): 10–15 exercises built from its items, with a
 * few from the two lessons before. Pure, with an injectable random source so
 * tests are deterministic.
 */
import { scriptUnits } from "@/lib/greek/script";

/** What the player needs to show one item. Built server-side from the learner's atom. */
export interface LessonItemView {
  atomId: string;
  key: string;
  /** How it is shown: a sign in capitals, a noun with its article, a letter as "Ρ ρ". */
  display: string;
  gloss: string;
  romanization?: string;
  /** What its audio says (lib/speech/say.ts). */
  speak?: string;
  type: "word" | "chunk";
  isLetter: boolean;
  /** The script unit a letter teaches ("ρ", "ου"). */
  unit?: string;
  mode?: "sight" | "heard";
  /** Can be sounded out now: not a sight word, and readable with the letters taught by the end of this lesson. */
  decodable: boolean;
  /** Already has memory state (met in a scene, mined, or learned before): taught again, not handed off again. */
  known: boolean;
  lookalike?: string;
  example?: { text: string; gloss: string };
  lang: "fr" | "el";
}

export type Exercise =
  | { kind: "meaning"; item: string; options: string[]; answer: number }
  | { kind: "hear"; item: string; options: string[]; answer: number }
  | { kind: "decode"; item: string }
  | { kind: "pairs"; items: string[] }
  | { kind: "build"; item: string; tiles: string[] }
  | { kind: "say"; item: string }
  | { kind: "sound"; letter: string; options: string[]; answer: number };

export const MAX_EXERCISES = 15;

/** A phrase's own words, as tiles. */
export function phraseTiles(display: string): string[] {
  return display.split(/\s+/).filter(Boolean);
}

/** One syllable is one vowel sound: too short for the transcriber (SPEC §15) and for "say it". */
export function oneSyllable(key: string): boolean {
  const vowels = scriptUnits(key).filter((u) => /^(α|ε|η|ι|ο|υ|ω|ου|αι|ει|οι)$/.test(u));
  return !key.includes(" ") && vowels.length <= 1;
}

function shuffle<T>(xs: T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Four options: the right one and three distinct distractors, shuffled. */
function choices(right: string, pool: string[], rnd: () => number): { options: string[]; answer: number } | undefined {
  const others = shuffle([...new Set(pool.filter((p) => p !== right))], rnd).slice(0, 3);
  if (others.length < 2) return undefined;
  const options = shuffle([right, ...others], rnd);
  return { options, answer: options.indexOf(right) };
}

export interface ExerciseInput {
  /** This lesson's items, letters first. */
  items: LessonItemView[];
  /** Items from the two lessons before, for a little mixed-in review. */
  recent: LessonItemView[];
  /** Everything the unit has taught so far (this lesson included): the distractor pool. */
  pool: LessonItemView[];
  /** Speaking is available and the learner hasn't said "can't speak now". */
  canSay: boolean;
}

export function buildExercises({ items, recent, pool, canSay }: ExerciseInput, rnd: () => number = Math.random): Exercise[] {
  const glosses = pool.filter((p) => !p.isLetter).map((p) => p.gloss);
  const displays = pool.filter((p) => !p.isLetter).map((p) => p.display);
  const words = items.filter((i) => !i.isLetter);
  const out: Exercise[] = [];

  // Letters: which word has this sound? One word with the letter among three without.
  for (const l of items.filter((i) => i.isLetter && i.unit)) {
    const withIt = pool.filter((p) => !p.isLetter && scriptUnits(p.key).includes(l.unit!));
    const without = pool.filter((p) => !p.isLetter && !scriptUnits(p.key).includes(l.unit!));
    const right = shuffle(withIt, rnd)[0];
    if (!right) continue;
    const c = choices(right.display, without.map((w) => w.display), rnd);
    if (c) out.push({ kind: "sound", letter: l.atomId, ...c });
  }

  for (const w of words) {
    const m = choices(w.gloss, glosses, rnd);
    if (m) out.push({ kind: "meaning", item: w.atomId, ...m });
    const h = choices(w.display, displays, rnd);
    if (h) out.push({ kind: "hear", item: w.atomId, ...h });
    if (w.decodable && w.romanization) out.push({ kind: "decode", item: w.atomId });
    if (w.type === "chunk" && phraseTiles(w.display).length >= 2) out.push({ kind: "build", item: w.atomId, tiles: shuffle(phraseTiles(w.display), rnd) });
    if (canSay && !oneSyllable(w.key)) out.push({ kind: "say", item: w.atomId });
  }

  // Keep the lesson to its length: drop extras round-robin, never an item's only exercise.
  const perItem = (e: Exercise) => ("item" in e ? e.item : undefined);
  while (out.length > MAX_EXERCISES - 3) {
    const counts = new Map<string, number>();
    for (const e of out) {
      const id = perItem(e);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    // Drop a "hear" or "build" (then "meaning") from the item with the most exercises.
    const busiest = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (!busiest || busiest[1] <= 1) break;
    const drop = ["hear", "build", "say", "meaning"].map((k) => out.findIndex((e) => e.kind === k && perItem(e) === busiest[0])).find((i) => i >= 0);
    if (drop === undefined) break;
    out.splice(drop, 1);
  }

  // Match pairs, when there are enough words.
  const pairable = shuffle([...words, ...recent], rnd).filter((v, i, a) => a.findIndex((x) => x.gloss === v.gloss) === i);
  if (pairable.length >= 4) out.push({ kind: "pairs", items: pairable.slice(0, 5).map((p) => p.atomId) });

  // A little of the two lessons before.
  for (const r of shuffle(recent, rnd).slice(0, 2)) {
    const m = choices(r.gloss, glosses, rnd);
    if (m) out.push({ kind: "meaning", item: r.atomId, ...m });
  }

  // Mixed, never the same item twice running.
  const mixed = shuffle(out, rnd);
  for (let i = 1; i < mixed.length; i++) {
    if (perItem(mixed[i]) && perItem(mixed[i]) === perItem(mixed[i - 1])) {
      const j = mixed.findIndex((e, k) => k > i && perItem(e) !== perItem(mixed[i - 1]));
      if (j > 0) [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
    }
  }
  return mixed.slice(0, MAX_EXERCISES);
}

/** Per-item results across a lesson's practice, for the hand-off (SPEC §17). */
export interface ItemStats {
  attempts: number;
  misses: number;
  firstTimeRight: boolean;
}
