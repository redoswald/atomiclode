/**
 * Writing later visits, and custom scenarios (SPEC §10 "Where visits come from").
 * One model call per visit, stored and never regenerated.
 */
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, scenarios, scenarioVisits } from "@/db/schema";
import { generateVisit as generateWithModel, type GeneratedVisit, type GenerateVisitInput } from "@/lib/llm/scenario";
import { isKnownStatus } from "@/lib/reader/coverage";
import type { BundleEntry } from "./seed";
import { storeVisit } from "./visits";

export type GenerateVisitFn = (input: GenerateVisitInput) => Promise<GeneratedVisit>;

/** How many unknown frequency-list lemmas the model gets to choose from. */
export const CANDIDATES = 120;

async function generatorInput(d: Db, extraCandidates: string[]): Promise<Pick<GenerateVisitInput, "known" | "chunks" | "candidates" | "grammar">> {
  const rows = await d.select({ id: atoms.id, type: atoms.type, key: atoms.key, gloss: atoms.gloss, status: atoms.status, rank: atoms.frequencyRank }).from(atoms);
  // Bundles already handed out count as known here: they are on their way in, and shouldn't be taught twice.
  const started = await d.select({ bundle: scenarioVisits.bundle }).from(scenarioVisits).where(isNotNull(scenarioVisits.startedAt));
  const inFlight = new Set(started.flatMap((v) => v.bundle));
  const usable = (r: (typeof rows)[number]) => isKnownStatus(r.status) || inFlight.has(r.id);

  const fromList = rows
    .filter((r) => r.type === "word" && r.status === "new" && !inFlight.has(r.id) && r.rank !== null)
    .sort((a, b) => a.rank! - b.rank!)
    .slice(0, CANDIDATES)
    .map((r) => r.key);
  const unknownExtra = new Set(extraCandidates.filter((k) => !rows.some((r) => r.type === "word" && r.key === k && usable(r))));
  return {
    known: rows.filter((r) => r.type === "word" && usable(r)).map((r) => r.key),
    chunks: rows.filter((r) => r.type === "chunk" && usable(r)).map((r) => r.key),
    candidates: Array.from(new Set([...fromList.slice(0, CANDIDATES - Math.min(30, unknownExtra.size)), ...[...unknownExtra].slice(0, 30)])),
    grammar: rows.filter((r) => r.type === "grammar" && r.status === "new" && !inFlight.has(r.id)).map((r) => `${r.key}: ${r.gloss}`),
  };
}

function toBundle(g: GeneratedVisit): BundleEntry[] {
  const bundle: BundleEntry[] = g.bundle.slice(0, 10).map((b) => ({ type: b.type, key: b.key.trim().toLowerCase(), gloss: b.gloss.trim() }));
  if (g.grammarKey.trim()) bundle.push({ type: "grammar", key: g.grammarKey.trim(), gloss: "" });
  return bundle.filter((b) => b.key);
}

export interface NextVisitOptions {
  generate?: GenerateVisitFn;
  /** Unknown lemmas from the active goal text, so the goal reaches back into the foundation (SPEC §11). */
  goalLemmas?: string[];
  now?: Date;
}

/** Write the next visit of a scenario. Refuses while the latest one hasn't been opened. */
export async function generateNextVisit(d: Db, scenarioId: string, opts: NextVisitOptions = {}): Promise<{ visitId: string; n: number }> {
  const [scenario] = await d.select().from(scenarios).where(eq(scenarios.id, scenarioId));
  if (!scenario) throw new Error("unknown scenario");
  const earlier = await d.select().from(scenarioVisits).where(eq(scenarioVisits.scenarioId, scenarioId)).orderBy(asc(scenarioVisits.n));
  const latest = earlier[earlier.length - 1];
  if (latest && !latest.startedAt) throw new Error("There's a visit here you haven't opened yet.");
  const n = (latest?.n ?? 0) + 1;

  const generate = opts.generate ?? generateWithModel;
  const g = await generate({
    scenario: { title: scenario.title, brief: scenario.brief },
    n,
    earlier: earlier.map((v) => v.summary || v.brief),
    ...(await generatorInput(d, opts.goalLemmas ?? [])),
  });
  if (g.dialogue.trim().split(/\s+/).length < 30) throw new Error("The model returned too short a dialogue; try again.");
  const visitId = await storeVisit(
    d,
    scenario,
    n,
    { brief: g.brief.trim(), summary: g.summary.trim(), dialogue: g.dialogue.trim(), translation: g.translation.trim(), bundle: toBundle(g), prompts: g.prompts },
    opts.now,
  );
  if (!scenario.title && g.title.trim()) await d.update(scenarios).set({ title: g.title.trim() }).where(eq(scenarios.id, scenarioId));
  return { visitId, n };
}

/** "Meeting her grandmother on Sunday": a scenario from the learner's own words, with its first visit. */
export async function createCustomScenario(
  d: Db,
  situation: string,
  opts: NextVisitOptions & { origin?: "custom" | "goal"; goalId?: string } = {},
): Promise<{ scenarioId: string; visitId: string }> {
  const brief = situation.trim().replace(/\s+/g, " ");
  if (brief.length < 10) throw new Error("Describe the situation in a sentence.");
  if (brief.length > 400) throw new Error("Keep it to a sentence or two.");
  const [row] = await d
    .insert(scenarios)
    .values({ slug: `${opts.origin ?? "custom"}-${crypto.randomUUID().slice(0, 8)}`, title: "", brief, origin: opts.origin ?? "custom", goalId: opts.goalId ?? null })
    .returning({ id: scenarios.id });
  try {
    const { visitId } = await generateNextVisit(d, row.id, opts);
    const [named] = await d.select({ title: scenarios.title }).from(scenarios).where(eq(scenarios.id, row.id));
    if (!named.title) await d.update(scenarios).set({ title: brief.length > 40 ? brief.slice(0, 37).trimEnd() + "…" : brief }).where(eq(scenarios.id, row.id));
    return { scenarioId: row.id, visitId };
  } catch (err) {
    await d.delete(scenarios).where(and(eq(scenarios.id, row.id), inArray(scenarios.origin, ["custom", "goal"])));
    throw err;
  }
}
