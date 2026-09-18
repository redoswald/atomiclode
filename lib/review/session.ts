import { and, eq, gte, min, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, encounters, reviewEvents, sentences } from "@/db/schema";
import { rowToAtom } from "@/lib/atoms/rows";
import type { Atom, AtomType, Encounter, Modality, Sentence } from "@/lib/atoms/types";
import { hasAnthropicKey } from "@/lib/llm/client";
import { applyExposure } from "@/lib/scheduler/exposure";
import { normalizeForm } from "@/lib/reader/lexicon";
import { planSession, type Intensity, type SessionPlan, type SessionReason } from "@/lib/scheduler";
import { newAtomOrder } from "./newOrder";
import { promptsFor, writePrompts, type WritePromptFn } from "./produce";

export const BUDGETS: Record<Intensity, number> = { light: 5, steady: 12, push: 20 };
export const DEFAULT_NEW_PER_DAY = 10;
/** Produce cards per session. They cost a model call each, and forty seconds of the learner. */
export const PRODUCE_MAX: Record<Intensity, number> = { light: 0, steady: 3, push: 5 };

/** Everything the client needs to render one item. Never includes memory state. */
export interface SessionCard {
  atomId: string;
  modality: Modality;
  reason: SessionReason;
  type: AtomType;
  key: string;
  gloss: string;
  forms: string[];
  pos?: string;
  gender?: "m" | "f";
  explanation?: string;
  sentence?: { id: string; text: string; translation?: string };
  /** For cloze: the sentence split around the gap. */
  cloze?: { before: string; answer: string; after: string };
  /** For produce: the situation to answer and what it is fishing for. */
  produce?: { promptId: string; situation: string; exampleAnswer: string; targets: Array<{ atomId: string; key: string; gloss: string }> };
  /** One line on how the modalities compare, e.g. "Recognition is strong, production needs work." */
  insight?: string;
}

export interface BuiltSession {
  plan: SessionPlan;
  cards: SessionCard[];
  intensity: Intensity;
  timeBudgetMin: number;
}

export function parseIntensity(v: unknown): Intensity {
  return v === "light" || v === "push" ? v : "steady";
}

export interface BuildOptions {
  /** Produce needs a model to grade it; defaults to whether an API key is set. */
  produce?: boolean;
  writePrompt?: WritePromptFn;
}

export async function buildSession(d: Db, intensity: Intensity, now = new Date(), opts: BuildOptions = {}): Promise<BuiltSession> {
  const produce = opts.produce ?? hasAnthropicKey();
  const timeBudgetMin = BUDGETS[intensity];
  const [order, rows, sentenceRows, introduced, recentEncounters] = await Promise.all([
    newAtomOrder(d, produce),
    d.select().from(atoms).where(sql`${atoms.status} <> 'suspended'`),
    d.select().from(sentences),
    newAtomsIntroducedToday(d, now),
    d
      .select()
      .from(encounters)
      .where(gte(encounters.at, new Date(now.getTime() - 30 * 86_400_000).toISOString())),
  ]);
  // Exposure signals from reading (SPEC §4): small stability bumps, fragile words pulled forward.
  const exposure: Encounter[] = recentEncounters.map((e) => ({
    atomId: e.atomId,
    sentenceId: e.sentenceId ?? "",
    passageId: e.passageId ?? "",
    at: e.at,
    tapped: e.tapped,
  }));
  const all: Atom[] = [];
  for (const row of rows) {
    const before = rowToAtom(row);
    const { atom } = applyExposure(before, exposure, now.toISOString());
    if (atom !== before) {
      await d.update(atoms).set({ stability: atom.memory.stability, due: atom.memory.due }).where(eq(atoms.id, atom.id));
    }
    all.push(atom);
  }
  const sentenceList: Sentence[] = sentenceRows.map((s) => ({
    id: s.id,
    text: s.text,
    translation: s.translation ?? undefined,
    atomIds: s.atomIds,
    origin: s.origin,
    sourceRef: s.sourceRef ?? undefined,
  }));

  const plan = planSession(all, sentenceList, {
    now: now.toISOString(),
    timeBudgetMin,
    newAtomsPerDay: DEFAULT_NEW_PER_DAY,
    newAtomsIntroducedToday: introduced,
    intensity,
    produceMax: produce ? PRODUCE_MAX[intensity] : 0,
    newOrder: order.newOrder,
    noFrequencyFallback: order.noFrequencyFallback,
  });

  // Triage: persist the bulk deferrals so the next plan sees them.
  for (const def of plan.deferrals) {
    await d.update(atoms).set({ due: def.due }).where(eq(atoms.id, def.atomId));
  }

  const byId = new Map(all.map((a) => [a.id, a]));

  // Produce cards need a situation: a stored one, or one written now (a few per session at most).
  const wantProduce = plan.items.filter((i) => i.modality === "produce").map((i) => byId.get(i.atomId)!);
  const prompts = await promptsFor(d, wantProduce);
  const unprompted = wantProduce.filter((a) => !prompts.has(a.id));
  for (const [id, row] of await writePrompts(d, unprompted, opts.writePrompt)) prompts.set(id, row);

  const sentenceById = new Map(sentenceList.map((s) => [s.id, s]));
  const cards: SessionCard[] = plan.items.map((item) => {
    const a = byId.get(item.atomId)!;
    const s = item.sentenceId ? sentenceById.get(item.sentenceId) : undefined;
    const cloze = item.modality === "cloze" && s ? findGap(s.text, [a.key, ...a.forms]) : undefined;
    const prompt = item.modality === "produce" ? prompts.get(a.id) : undefined;
    return {
      atomId: a.id,
      // A cloze with no findable gap degrades to recognize-in-context; a produce with no situation, to recall.
      modality: item.modality === "cloze" && !cloze ? "recognize" : item.modality === "produce" && !prompt ? "recall" : item.modality,
      cloze,
      produce: prompt && {
        promptId: prompt.id,
        situation: prompt.situation,
        exampleAnswer: prompt.exampleAnswer,
        targets: prompt.targetAtomIds.flatMap((id) => {
          const t = byId.get(id);
          return t ? [{ atomId: id, key: t.key, gloss: t.gloss }] : [];
        }),
      },
      insight: insightFor(a),
      reason: item.reason,
      type: a.type,
      key: a.key,
      gloss: a.gloss,
      forms: a.forms,
      pos: a.pos,
      gender: a.gender,
      explanation: a.explanation,
      sentence: s ? { id: s.id, text: s.text, translation: s.translation } : undefined,
    };
  });

  return { plan, cards, intensity, timeBudgetMin };
}

/** Atoms whose first-ever review happened since the start of today (UTC). */
export async function newAtomsIntroducedToday(d: Db, now = new Date()): Promise<number> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const firsts = d
    .select({ atomId: reviewEvents.atomId, first: min(reviewEvents.at).as("first") })
    .from(reviewEvents)
    .groupBy(reviewEvents.atomId)
    .as("firsts");
  const [row] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(firsts)
    .where(and(gte(firsts.first, dayStart)));
  return row?.n ?? 0;
}

/** A short read on the atom's modality balance, or nothing when there is too little data. */
export function insightFor(a: Atom): string | undefined {
  const rec = a.modality.recognize;
  const prod = { attempts: a.modality.recall.attempts + a.modality.cloze.attempts + a.modality.produce.attempts, correct: a.modality.recall.correct + a.modality.cloze.correct + a.modality.produce.correct };
  if (a.memory.lapses >= 3) return `Slippery: forgotten ${a.memory.lapses} times so far.`;
  if (rec.attempts < 3 || prod.attempts < 2) return undefined;
  const recAcc = rec.correct / rec.attempts;
  const prodAcc = prod.correct / prod.attempts;
  if (recAcc - prodAcc >= 0.3) return "Recognition is strong, production needs work.";
  if (prodAcc >= 0.8 && recAcc >= 0.8) return "Solid both ways.";
  if (prodAcc - recAcc >= 0.3) return "You can produce it; recognition lags, oddly.";
  return undefined;
}

/**
 * Locate the atom's surface form in a sentence (accent- and case-insensitive,
 * whole word) and split the sentence around it. Longest form first.
 */
export function findGap(sentence: string, forms: string[]): { before: string; answer: string; after: string } | undefined {
  const norm = (x: string) =>
    normalizeForm(x)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const target = norm(sentence);
  const wordChar = /[a-z]/;
  for (const form of [...new Set(forms)].filter(Boolean).sort((x, y) => y.length - x.length)) {
    const f = norm(form);
    if (!f) continue;
    let from = 0;
    while (from <= target.length - f.length) {
      const i = target.indexOf(f, from);
      if (i < 0) break;
      const leftOk = i === 0 || !wordChar.test(target[i - 1]);
      const rightOk = i + f.length === target.length || !wordChar.test(target[i + f.length]);
      if (leftOk && rightOk && norm(sentence.slice(i, i + f.length)) === f) {
        return { before: sentence.slice(0, i), answer: sentence.slice(i, i + f.length), after: sentence.slice(i + f.length) };
      }
      from = i + 1;
    }
  }
  return undefined;
}
