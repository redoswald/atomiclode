/**
 * Scenarios (SPEC §10): recurring situations that grow a visit at a time. A
 * scenario is a source of new atoms and of sentences for them to live in; the
 * scheduler never reads its state for due-ness, and nothing is locked.
 */
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, passages, producePrompts, scenarios, scenarioVisits, sentences, type ScenarioRow, type ScenarioVisitRow } from "@/db/schema";
import type { AtomType, MemoryStatus } from "@/lib/atoms/types";
import { normalizeForm } from "@/lib/reader/lexicon";
import { createPassage } from "@/lib/reader/passages";
import { analyzeLocal } from "@/lib/reader/tokenize";
import { appearsIn, type BundleEntry, type VisitEntry } from "./seed";

/** A bundle counts as absorbed, and the next visit is offered, once this share of it is no longer `new`. */
export const BUNDLE_ABSORBED = 0.8;

interface EnsuredAtom {
  id: string;
  type: AtomType;
  key: string;
  status: MemoryStatus;
}

/** Find or create the atom for a bundle entry. Grammar atoms are only ever linked, never invented here. */
async function ensureAtom(d: Db, entry: BundleEntry, surfaces: string[]): Promise<EnsuredAtom | undefined> {
  const key = entry.type === "grammar" ? entry.key : normalizeForm(entry.key);
  const [existing] = await d.select().from(atoms).where(and(eq(atoms.type, entry.type), eq(atoms.key, key)));
  if (existing) {
    const forms = Array.from(new Set([...existing.forms, ...surfaces]));
    if (!existing.gloss || forms.length !== existing.forms.length) {
      await d.update(atoms).set({ gloss: existing.gloss || entry.gloss, forms }).where(eq(atoms.id, existing.id));
    }
    return { id: existing.id, type: existing.type, key, status: existing.status };
  }
  if (entry.type === "grammar") return undefined;
  const [row] = await d
    .insert(atoms)
    .values({ type: entry.type, key, forms: Array.from(new Set([key, ...surfaces])), gloss: entry.gloss, source: "scenario", status: "new" })
    .returning({ id: atoms.id });
  return { id: row.id, type: entry.type, key, status: "new" };
}

/**
 * Store one visit: its atoms, its dialogue as an ordinary passage, its produce
 * prompts. Bundle entries the dialogue doesn't actually use are dropped, and
 * only atoms still new to the learner make it into the bundle.
 */
export async function storeVisit(d: Db, scenario: Pick<ScenarioRow, "id" | "title">, n: number, visit: VisitEntry, now = new Date()): Promise<string> {
  const { tokens } = analyzeLocal(visit.dialogue);
  const used = visit.bundle.filter((b) => appearsIn(b, tokens));
  if (used.filter((b) => b.type !== "grammar").length < 3) throw new Error("That visit taught too little; try again.");

  const byKey = new Map<string, EnsuredAtom>();
  const bundle: string[] = [];
  for (const entry of used) {
    const key = normalizeForm(entry.key);
    const surfaces = entry.type === "word" ? tokens.filter((t) => t.isWord && t.lemma === key).map((t) => normalizeForm(t.surface)) : [];
    const atom = await ensureAtom(d, entry, surfaces);
    if (!atom) continue;
    byKey.set(entry.key, atom);
    if (atom.status === "new" && !bundle.includes(atom.id)) bundle.push(atom.id);
  }

  // Atoms first, passage second: the bundle's chunks must exist for the analysis to mark them.
  const { id: passageId } = await createPassage(d, { title: n === 1 ? scenario.title : `${scenario.title} · ${n}`, text: visit.dialogue, origin: "scenario" });
  const [row] = await d
    .insert(scenarioVisits)
    .values({ scenarioId: scenario.id, n, brief: visit.brief, summary: visit.summary, passageId, translation: visit.translation, bundle, createdAt: now.toISOString() })
    .returning({ id: scenarioVisits.id });

  for (const p of visit.prompts) {
    const targetAtomIds = p.targets.map((t) => byKey.get(t)?.id).filter((x): x is string => Boolean(x));
    // Seed prompts may reach back to an earlier scenario's atoms.
    const missing = p.targets.filter((t) => !byKey.has(t)).map(normalizeForm);
    if (missing.length) {
      const found = await d.select({ id: atoms.id }).from(atoms).where(and(inArray(atoms.type, ["word", "chunk"]), inArray(atoms.key, missing)));
      targetAtomIds.push(...found.map((f) => f.id));
    }
    if (targetAtomIds.length === 0) continue;
    await d.insert(producePrompts).values({ visitId: row.id, situation: p.situation, exampleAnswer: p.exampleAnswer, targetAtomIds });
  }
  return row.id;
}

/**
 * First time a visit is opened: its bundle joins the queue (frequency-list atoms
 * change source, per SPEC §3) and each line of the dialogue that holds a bundle
 * atom is saved as a sentence, so cloze cards come from the café, not from nowhere.
 */
export async function startVisit(d: Db, visitId: string, now = new Date()): Promise<void> {
  const [visit] = await d.select().from(scenarioVisits).where(eq(scenarioVisits.id, visitId));
  if (!visit || visit.startedAt) return;
  await d.update(scenarioVisits).set({ startedAt: now.toISOString() }).where(eq(scenarioVisits.id, visitId));
  if (visit.bundle.length === 0 || !visit.passageId) return;

  await d
    .update(atoms)
    .set({ source: "scenario" })
    .where(and(inArray(atoms.id, visit.bundle), eq(atoms.status, "new"), eq(atoms.source, "frequency")));

  const [passage] = await d.select().from(passages).where(eq(passages.id, visit.passageId));
  if (!passage) return;
  const bundleAtoms = await d.select({ id: atoms.id, type: atoms.type, key: atoms.key }).from(atoms).where(inArray(atoms.id, visit.bundle));
  for (let idx = 0; idx < passage.sentenceTexts.length; idx++) {
    const lineTokens = passage.tokens.filter((t) => t.sentenceIdx === idx);
    const atomIds = bundleAtoms.filter((a) => a.type !== "grammar" && appearsIn({ type: a.type, key: a.key, gloss: "" }, lineTokens)).map((a) => a.id);
    if (atomIds.length === 0) continue;
    const [existing] = await d
      .select({ id: sentences.id, atomIds: sentences.atomIds })
      .from(sentences)
      .where(and(eq(sentences.passageId, passage.id), eq(sentences.passageIdx, idx)));
    if (existing) {
      await d.update(sentences).set({ atomIds: Array.from(new Set([...existing.atomIds, ...atomIds])) }).where(eq(sentences.id, existing.id));
    } else {
      await d.insert(sentences).values({ text: passage.sentenceTexts[idx], atomIds, origin: "scenario", sourceRef: `visit:${visitId}`, passageId: passage.id, passageIdx: idx });
    }
  }
}

/** Bundles of the visits in progress, oldest first: the scheduler's `newOrder` (SPEC §4.2). */
export async function scenarioNewOrder(d: Db): Promise<string[]> {
  const rows = await d.select({ bundle: scenarioVisits.bundle }).from(scenarioVisits).where(isNotNull(scenarioVisits.startedAt)).orderBy(asc(scenarioVisits.startedAt));
  return Array.from(new Set(rows.flatMap((r) => r.bundle)));
}

export interface VisitProgress {
  visit: ScenarioVisitRow;
  /** Bundle atoms no longer `new`. */
  introduced: number;
  absorbed: boolean;
}

export interface ScenarioState {
  scenario: ScenarioRow;
  visits: VisitProgress[];
  latest?: VisitProgress;
  /** "ready": an unopened visit is waiting. "learning": the last bundle is still coming in. "next": time for a new visit. */
  state: "ready" | "learning" | "next";
  lastStartedAt?: string;
}

export async function scenarioStates(d: Db): Promise<ScenarioState[]> {
  const [all, visits] = await Promise.all([
    d.select().from(scenarios).orderBy(asc(scenarios.createdAt)),
    d.select().from(scenarioVisits).orderBy(asc(scenarioVisits.n)),
  ]);
  const bundleIds = Array.from(new Set(visits.flatMap((v) => v.bundle)));
  const statusRows = bundleIds.length ? await d.select({ id: atoms.id, status: atoms.status }).from(atoms).where(inArray(atoms.id, bundleIds)) : [];
  const status = new Map(statusRows.map((r) => [r.id, r.status]));

  return all.map((scenario) => {
    const mine = visits
      .filter((v) => v.scenarioId === scenario.id)
      .map((visit) => {
        const introduced = visit.bundle.filter((id) => status.get(id) !== "new").length;
        return { visit, introduced, absorbed: visit.bundle.length === 0 || introduced / visit.bundle.length >= BUNDLE_ABSORBED };
      });
    const latest = mine[mine.length - 1];
    const state = !latest || (latest.visit.startedAt && latest.absorbed) ? "next" : latest.visit.startedAt ? "learning" : "ready";
    const lastStartedAt = mine.map((m) => m.visit.startedAt).filter((x): x is string => Boolean(x)).sort().pop();
    return { scenario, visits: mine, latest, state, lastStartedAt };
  });
}

export interface VisitSuggestion {
  scenario: ScenarioRow;
  /** The visit to open, or undefined when it still has to be written (needs a model). */
  visit?: ScenarioVisitRow;
  n: number;
}

/**
 * What the Learn row offers (SPEC §10 "Which visit next"). While a bundle is
 * still coming in, nothing: finish that first. Otherwise goal scenarios first,
 * then the least recently visited, unopened visits before ones yet to be written.
 */
export function suggestVisit(states: ScenarioState[], canGenerate: boolean): VisitSuggestion | undefined {
  if (states.some((s) => s.state === "learning")) return undefined;
  const rank = (s: ScenarioState) => [s.scenario.origin === "goal" ? 0 : 1, s.state === "ready" ? 0 : 1, s.lastStartedAt ?? ""] as const;
  const open = states
    .filter((s) => s.state === "ready" || (s.state === "next" && canGenerate))
    .sort((a, b) => {
      const [ra, rb] = [rank(a), rank(b)];
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]);
    });
  const pick = open[0];
  if (!pick) return undefined;
  return pick.state === "ready" ? { scenario: pick.scenario, visit: pick.latest!.visit, n: pick.latest!.visit.n } : { scenario: pick.scenario, n: (pick.latest?.visit.n ?? 0) + 1 };
}

/** Is there a scenario visit on offer or under way? Then new atoms don't fall back to the bare frequency list. */
export function scenariosLead(states: ScenarioState[], canGenerate: boolean): boolean {
  return states.some((s) => s.state === "learning") || suggestVisit(states, canGenerate) !== undefined;
}

export async function visitCount(d: Db): Promise<number> {
  const [row] = await d.select({ n: sql<number>`count(*)::int` }).from(scenarioVisits);
  return row?.n ?? 0;
}
