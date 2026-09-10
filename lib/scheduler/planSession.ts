import type { Atom, Modality, Sentence } from "@/lib/atoms/types";
import { MODALITY_SECONDS } from "./modality";

export type Intensity = "light" | "steady" | "push";

export interface SessionRequest {
  now: string;
  timeBudgetMin: number; // 5 / 12 / 20
  newAtomsPerDay: number; // default 10
  newAtomsIntroducedToday: number;
  intensity: Intensity;
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
  const fresh = atoms
    .filter((a) => a.memory.status === "new" && a.gloss.trim() !== "") // nothing to learn from a bare word
    .sort(compareNew)
    .slice(0, newCap);

  // ---- modality + budget --------------------------------------------------
  const items: SessionItem[] = [];
  let seconds = 0;
  let skipped = 0;
  let dueFit = 0;
  const notFit: Atom[] = [];

  for (const { atom, reason } of due) {
    const sentence = sentenceFor.get(atom.id)?.[0];
    const modality = chooseModality(atom, sentence !== undefined, req.intensity);
    const cost = MODALITY_SECONDS[modality];
    if (seconds + cost <= budgetSec) {
      items.push({ atomId: atom.id, modality, sentenceId: modality === "cloze" ? sentence?.id : undefined, reason });
      seconds += cost;
      dueFit++;
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

/** Mined atoms before frequency-list ones, then by frequency rank, then oldest first. */
function compareNew(a: Atom, b: Atom): number {
  const minedA = a.source === "frequency" ? 1 : 0;
  const minedB = b.source === "frequency" ? 1 : 0;
  if (minedA !== minedB) return minedA - minedB;
  const rankA = a.frequencyRank ?? Number.MAX_SAFE_INTEGER;
  const rankB = b.frequencyRank ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/**
 * SPEC §4.3. Recognize is the floor; recall when under-tested; cloze when a mined
 * sentence exists and cloze wasn't the most recent rep (approximates "not in the
 * last 3 reps", which the counters can't tell); produce once stability > 7 days.
 * light picks the easiest eligible modality, push the hardest, steady the cascade.
 */
export function chooseModality(atom: Atom, hasSentence: boolean, intensity: Intensity): Modality {
  const s = atom.modality;
  const m = atom.memory;
  if (m.status === "new") return "recognize";

  const recallWanted = s.recall.attempts < 0.6 * s.recognize.attempts;
  const clozeOk = hasSentence && (s.cloze.lastAt === undefined || (m.lastReview !== undefined && s.cloze.lastAt < m.lastReview));
  const produceOk = m.stability > PRODUCE_MIN_STABILITY_DAYS;

  if (intensity === "light") return "recognize";
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
