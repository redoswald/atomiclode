import { and, eq, gte, min, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, reviewEvents, sentences } from "@/db/schema";
import { rowToAtom } from "@/lib/atoms/rows";
import type { Atom, AtomType, Modality, Sentence } from "@/lib/atoms/types";
import { planSession, type Intensity, type SessionPlan, type SessionReason } from "@/lib/scheduler";

export const BUDGETS: Record<Intensity, number> = { light: 5, steady: 12, push: 20 };
export const DEFAULT_NEW_PER_DAY = 10;

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

export async function buildSession(d: Db, intensity: Intensity, now = new Date()): Promise<BuiltSession> {
  const timeBudgetMin = BUDGETS[intensity];
  const [rows, sentenceRows, introduced] = await Promise.all([
    d.select().from(atoms).where(sql`${atoms.status} <> 'suspended'`),
    d.select().from(sentences),
    newAtomsIntroducedToday(d, now),
  ]);
  const all: Atom[] = rows.map(rowToAtom);
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
  });

  // Triage: persist the bulk deferrals so the next plan sees them.
  for (const def of plan.deferrals) {
    await d.update(atoms).set({ due: def.due }).where(eq(atoms.id, def.atomId));
  }

  const byId = new Map(all.map((a) => [a.id, a]));
  const sentenceById = new Map(sentenceList.map((s) => [s.id, s]));
  const cards: SessionCard[] = plan.items.map((item) => {
    const a = byId.get(item.atomId)!;
    const s = item.sentenceId ? sentenceById.get(item.sentenceId) : undefined;
    return {
      atomId: a.id,
      modality: item.modality,
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
