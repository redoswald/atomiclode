import type { Atom, Modality, Sentence } from "@/lib/atoms/types";
import { MODALITY_SECONDS } from "./modality";

export type Intensity = "light" | "steady" | "push";

export interface SessionRequest {
  now: string;
  timeBudgetMin: number; // 5 / 12 / 20
  newAtomsPerDay: number; // default 10
  newAtomsIntroducedToday: number;
  intensity: Intensity;
  /**
   * Most produce items the session may hold. Defaults to 0: produce needs a model to
   * grade it, so the caller opts in only when one is available (SPEC §4, §6).
   */
  produceMax?: number;
  /**
   * New atoms to introduce first, in order: the bundles of scenario visits in progress and
   * the active goal text's unknowns (SPEC §10, §11). Hand-mined atoms still come before these.
   */
  newOrder?: string[];
  /**
   * Foundation phase with a scenario visit on offer: new atoms come only from `newOrder`
   * and mining, never from the bare frequency list.
   */
  noFrequencyFallback?: boolean;
}

export type SessionReason = "due" | "overdue" | "new" | "weak-modality" | "relearn";

export interface SessionItem {
  atomId: string;
  modality: Modality;
  sentenceId?: string; // required for cloze
  reason: SessionReason;
}

export interface Deferral {
  atomId: string;
  due: string;
}

export interface SessionPlan {
  items: SessionItem[]; // ordered
  estimatedMin: number;
  skipped: number; // due atoms that didn't fit
  deferred: number; // bulk-deferred in triage mode
  /** New due dates for bulk-deferred atoms; the caller persists these. (Not in SPEC §4.) */
  deferrals: Deferral[];
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Triage kicks in when the due pile is more than this many sessions deep. */
export const TRIAGE_RATIO = 3;
/** Produce is only offered once an atom is this stable. */
export const PRODUCE_MIN_STABILITY_DAYS = 7;

/**
 * Pure. Chooses what to review now, with which modality, in what order.
 * See SPEC §4 for the rules; the comments below note where this approximates them.
 */
export function planSession(atoms: Atom[], sentences: Sentence[], req: SessionRequest): SessionPlan {
  const now = new Date(req.now).getTime();
  const budgetSec = req.timeBudgetMin * 60;
  const sessionMs = req.timeBudgetMin * 60_000;
  const sentenceFor = minedSentences(sentences);

  // ---- candidates ---------------------------------------------------------
  const due: Array<{ atom: Atom; reason: SessionReason; priority: number }> = [];
  for (const a of atoms) {
    const m = a.memory;
    if (m.status !== "learning" && m.status !== "review") continue;
    const dueAt = new Date(m.due).getTime();
    // Learning steps that come due during the session count; push pulls in tomorrow's reviews.
    const horizon = m.status === "learning" ? sessionMs : req.intensity === "push" ? 24 * HOUR_MS : 0;
    if (dueAt > now + horizon) continue;

    const lateMs = now - dueAt;
    const lapsedRecently = m.lapses > 0 && m.lastReview !== undefined && now - new Date(m.lastReview).getTime() < DAY_MS;
    if (m.status === "learning" && lapsedRecently) {
      due.push({ atom: a, reason: "relearn", priority: 3e9 + lateMs });
    } else if (lateMs > DAY_MS) {
      // Lateness relative to stability: 3 days late on a 4-day card outranks 3 days late on a 60-day card.
      due.push({ atom: a, reason: "overdue", priority: 2e9 + (lateMs / DAY_MS / Math.max(m.stability, 0.5)) * 1e6 });
    } else {
      due.push({ atom: a, reason: "due", priority: 1e9 + lateMs });
    }
  }
  due.sort((x, y) => y.priority - x.priority);

  const multiplier = req.intensity === "light" ? 0 : req.intensity === "push" ? 2 : 1;
  const newCap = Math.max(0, multiplier * req.newAtomsPerDay - req.newAtomsIntroducedToday);
  const orderIndex = new Map((req.newOrder ?? []).map((id, i) => [id, i]));
  const fresh = atoms
    .filter((a) => a.memory.status === "new" && a.gloss.trim() !== "") // nothing to learn from a bare word
    .filter((a) => newTier(a, orderIndex) < (req.noFrequencyFallback ? 2 : 3))
    .sort((a, b) => compareNew(a, b, orderIndex))
    .slice(0, newCap);

  // ---- modality + budget --------------------------------------------------
  const items: SessionItem[] = [];
  let seconds = 0;
  let skipped = 0;
  let dueFit = 0;
  let produceLeft = req.produceMax ?? 0;
  const notFit: Atom[] = [];

  for (const { atom, reason } of due) {
    const sentence = sentenceFor.get(atom.id)?.[0];
    const modality = chooseModality(atom, sentence !== undefined, req.intensity, produceLeft > 0);
    const cost = MODALITY_SECONDS[modality];
    if (seconds + cost <= budgetSec) {
      items.push({ atomId: atom.id, modality, sentenceId: modality === "cloze" ? sentence?.id : undefined, reason });
      seconds += cost;
      dueFit++;
      if (modality === "produce") produceLeft--;
    } else {
      notFit.push(atom);
      skipped++;
    }
  }
  for (const atom of fresh) {
    const cost = MODALITY_SECONDS.recognize;
    if (seconds + cost <= budgetSec) {
      items.push({ atomId: atom.id, modality: "recognize", reason: "new" });
      seconds += cost;
    } else {
      skipped++;
    }
  }

  // ---- triage ---------------------------------------------------------------
  // Comeback after time away: keep the top slice, push the rest out in proportion
  // to their stability, and report the deferral instead of a scary due count.
  const deferrals: Deferral[] = [];
  if (dueFit > 0 && due.length > TRIAGE_RATIO * dueFit) {
    for (const atom of notFit) {
      const days = Math.min(14, Math.max(1, Math.round(atom.memory.stability / 4)));
      deferrals.push({ atomId: atom.id, due: new Date(now + days * DAY_MS).toISOString() });
    }
    skipped -= notFit.length;
  }

  return {
    items: interleave(items),
    estimatedMin: Math.round((seconds / 60) * 10) / 10,
    skipped,
    deferred: deferrals.length,
    deferrals,
  };
}

/**
 * Where a new atom comes from decides how soon it is introduced (SPEC §4.2):
 * mined by hand, then the caller's order (scenario bundles, goal text), then the
 * bare frequency list. A scenario or goal atom the caller didn't list belongs to
 * a visit that hasn't been opened yet: it waits there (tier 3, never introduced).
 */
function newTier(a: Atom, orderIndex: Map<string, number>): number {
  if (a.source === "mined" || a.source === "manual" || a.source === "conversation") return 0;
  if (orderIndex.has(a.id)) return 1;
  return a.source === "frequency" ? 2 : 3;
}

/** By tier, then the caller's order, then frequency rank, then oldest first. */
function compareNew(a: Atom, b: Atom, orderIndex: Map<string, number>): number {
  const tierA = newTier(a, orderIndex);
  const tierB = newTier(b, orderIndex);
  if (tierA !== tierB) return tierA - tierB;
  if (tierA === 1) return orderIndex.get(a.id)! - orderIndex.get(b.id)!;
  const rankA = a.frequencyRank ?? Number.MAX_SAFE_INTEGER;
  const rankB = b.frequencyRank ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/**
 * SPEC §4.3. Recognize is the floor; recall when under-tested; cloze when a mined
 * sentence exists and cloze wasn't the most recent rep (approximates "not in the
 * last 3 reps", which the counters can't tell); produce once stability > 7 days
 * and only while the session has produce slots left.
 * light picks the easiest eligible modality, push the hardest, steady the cascade.
 * Grammar atoms are ideas, not strings to type: always recognize. Receptive-only
 * atoms (SPEC §11) are never asked for in French: recognize or cloze.
 */
export function chooseModality(atom: Atom, hasSentence: boolean, intensity: Intensity, produceAllowed = false): Modality {
  const s = atom.modality;
  const m = atom.memory;
  if (m.status === "new" || atom.type === "grammar") return "recognize";

  const recallWanted = s.recall.attempts < 0.6 * s.recognize.attempts;
  const clozeOk = hasSentence && (s.cloze.lastAt === undefined || (m.lastReview !== undefined && s.cloze.lastAt < m.lastReview));
  const produceOk = produceAllowed && !atom.receptiveOnly && m.stability > PRODUCE_MIN_STABILITY_DAYS;

  if (intensity === "light") return "recognize";
  if (atom.receptiveOnly) return clozeOk ? "cloze" : "recognize";
  if (intensity === "push") {
    if (produceOk) return "produce";
    if (clozeOk) return "cloze";
    return "recall";
  }
  if (recallWanted) return "recall";
  if (clozeOk) return "cloze";
  if (produceOk && s.produce.attempts < s.recall.attempts) return "produce";
  return "recognize";
}

/** Mined sentences per atom (imported or conversation origin), most recent first by id order given. */
function minedSentences(sentences: Sentence[]): Map<string, Sentence[]> {
  const map = new Map<string, Sentence[]>();
  for (const s of sentences) {
    if (s.origin === "generated") continue;
    for (const id of s.atomIds) {
      const list = map.get(id) ?? [];
      list.push(s);
      map.set(id, list);
    }
  }
  return map;
}

/**
 * No two consecutive items on the same atom, and produce items spread through
 * the session rather than clustered at the end.
 */
export function interleave(items: SessionItem[]): SessionItem[] {
  const produce = items.filter((i) => i.modality === "produce");
  const rest = items.filter((i) => i.modality !== "produce");
  const out: SessionItem[] = [];
  if (produce.length === 0) return spreadSameAtom(items);
  const gap = (rest.length + produce.length) / produce.length;
  let nextProduceAt = Math.floor(gap / 2);
  let p = 0;
  for (let i = 0; i < rest.length + produce.length; i++) {
    if (p < produce.length && (i >= nextProduceAt || rest.length === 0)) {
      out.push(produce[p++]);
      nextProduceAt += gap;
    } else if (rest.length > out.length - p) {
      out.push(rest[out.length - p]);
    } else {
      out.push(produce[p++]);
    }
  }
  return spreadSameAtom(out);
}

function spreadSameAtom(items: SessionItem[]): SessionItem[] {
  const out = [...items];
  for (let i = 1; i < out.length; i++) {
    if (out[i].atomId !== out[i - 1].atomId) continue;
    const j = out.findIndex((it, k) => k > i && it.atomId !== out[i - 1].atomId);
    if (j === -1) break;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
