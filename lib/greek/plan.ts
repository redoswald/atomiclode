/**
 * Which letters and words a Greek learner meets next (SPEC §16). Pure: the
 * caller loads the atoms. Letters arrive a few at a time, chosen by what they
 * unlock, and a word is introduced only when at most one of its units is
 * unknown (that letter comes right before it). Scene and goal words lead and
 * pull in every letter they need.
 */
import type { AtomType, MemoryStatus } from "@/lib/atoms/types";
import { scriptUnits } from "./script";

export interface ScriptAtom {
  id: string;
  key: string;
  type: AtomType;
  status: MemoryStatus;
  pos?: string | null;
  domains: string[];
  frequencyRank?: number | null;
  gloss: string;
}

export interface ScriptPlan {
  /** Atom ids to introduce, in order: the Greek `newOrder`. */
  order: string[];
  /** New letters and words that must not be introduced yet, whatever their tier. */
  blocked: string[];
}

/** Letters that look and sound like their Latin counterparts: where every learner starts. */
export const FAMILIAR = ["α", "ε", "ι", "ο", "κ", "μ", "τ", "ζ"];
/** How far ahead to plan; recomputed every session, so a few days' worth is plenty. */
export const PLAN_LIMIT = 40;

const isLetter = (a: ScriptAtom) => a.pos === "LETTER";
const weight = (a: ScriptAtom) => (a.domains.includes("signs") ? 2 : 1);
const rank = (a: ScriptAtom) => a.frequencyRank ?? Number.MAX_SAFE_INTEGER;

export function planScript(atoms: ScriptAtom[], lead: string[] = [], limit = PLAN_LIMIT): ScriptPlan {
  const byId = new Map(atoms.map((a) => [a.id, a]));
  const letterByUnit = new Map(atoms.filter(isLetter).map((a) => [a.key.replace(/^letter:/, ""), a]));
  // A unit is known once its letter has been introduced. A unit with no letter atom can't be taught, so it never blocks.
  const known = new Set([...letterByUnit].filter(([, a]) => a.status !== "new").map(([u]) => u));
  const units = new Map<string, string[]>();
  const unitsOf = (a: ScriptAtom) => {
    let u = units.get(a.id);
    if (!u) units.set(a.id, (u = [...new Set(scriptUnits(a.key))].filter((x) => letterByUnit.has(x))));
    return u;
  };
  const missing = (a: ScriptAtom, have: Set<string>) => unitsOf(a).filter((u) => !have.has(u));

  const order: string[] = [];
  const placed = new Set<string>();
  const push = (id: string) => {
    if (placed.has(id)) return;
    placed.add(id);
    order.push(id);
  };
  const addLetter = (u: string) => {
    const l = letterByUnit.get(u);
    known.add(u);
    if (l && l.status === "new") push(l.id);
  };

  // Scenes and goals lead: their words pull in whatever letters they need.
  for (const id of lead) {
    const a = byId.get(id);
    if (!a) {
      push(id);
      continue;
    }
    if (isLetter(a)) addLetter(a.key.replace(/^letter:/, ""));
    else if (a.type !== "grammar") missing(a, known).forEach(addLetter);
    push(id);
  }

  const words = atoms.filter((a) => !isLetter(a) && a.type !== "grammar" && a.status === "new" && a.gloss.trim() !== "");
  while (order.length < limit) {
    const open = words.filter((w) => !placed.has(w.id));
    const byMissing = open.map((w) => ({ w, miss: missing(w, known) }));
    const best = (xs: typeof byMissing) => xs.sort((x, y) => weight(y.w) - weight(x.w) || rank(x.w) - rank(y.w) || x.w.key.localeCompare(y.w.key))[0];
    // A word readable today comes first.
    const readable = byMissing.filter((x) => x.miss.length === 0);
    if (readable.length) {
      push(best(readable).w.id);
      continue;
    }
    // Otherwise one new letter: the best of those that some word is waiting on alone,
    // then that letter's best word right after it. Failing that, the best letter outright.
    const oneAway = byMissing.filter((x) => x.miss.length === 1);
    const letter = nextLetter(open, letterByUnit, known, missing, oneAway.length ? new Set(oneAway.map((x) => x.miss[0])) : undefined);
    if (!letter) break;
    addLetter(letter);
    const opened = oneAway.filter((x) => x.miss[0] === letter);
    if (opened.length) push(best(opened).w.id);
  }

  const blocked = atoms
    .filter((a) => a.status === "new" && a.type !== "grammar" && !placed.has(a.id))
    .map((a) => a.id);
  return { order, blocked };
}

/**
 * The letter that makes the most words fully readable (signs count double); if
 * none would, the one that brings the most words within a letter of it. Ties go
 * to letters that look like their Latin selves, then to seed order.
 */
function nextLetter(
  open: ScriptAtom[],
  letterByUnit: Map<string, ScriptAtom>,
  known: Set<string>,
  missing: (a: ScriptAtom, have: Set<string>) => string[],
  only?: Set<string>,
): string | undefined {
  const candidates = [...letterByUnit]
    .filter(([u, a]) => !known.has(u) && a.status === "new" && (!only || only.has(u)))
    .map(([u, a]) => ({ u, a }));
  if (candidates.length === 0) return undefined;
  const scored = candidates.map(({ u, a }) => {
    const have = new Set(known).add(u);
    let readable = 0;
    let near = 0;
    for (const w of open) {
      const m = missing(w, have).length;
      if (m === 0) readable += weight(w);
      else if (m === 1) near += weight(w);
    }
    const familiar = FAMILIAR.indexOf(u);
    return { u, readable, near, familiar: familiar < 0 ? FAMILIAR.length : familiar, rank: rank(a) };
  });
  scored.sort((x, y) => y.readable - x.readable || y.near - x.near || x.familiar - y.familiar || x.rank - y.rank);
  return scored[0].u;
}
