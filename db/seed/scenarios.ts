import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, scenarios, scenarioVisits } from "@/db/schema";
import { validateScenarios, type ScenarioEntry } from "@/lib/scenarios/seed";
import { storeVisit } from "@/lib/scenarios/visits";

/**
 * Upsert the seed scenarios and write visit 1 of each where it doesn't exist
 * yet (SPEC §10). Idempotent, and it never touches a visit once stored, so the
 * learner's progress and any generated visits are left alone. Run after the
 * atom seed: grammar atoms must already exist.
 */
export async function seedScenarios(d: Db, entries: ScenarioEntry[], now = new Date()): Promise<{ scenarios: number; visitsWritten: number }> {
  const grammar = await d.select({ key: atoms.key }).from(atoms).where(eq(atoms.type, "grammar"));
  const problems = validateScenarios(entries, new Set(grammar.map((g) => g.key)));
  if (problems.length) throw new Error("Seed scenarios are inconsistent:\n  " + problems.join("\n  "));

  let visitsWritten = 0;
  for (const [i, e] of entries.entries()) {
    // File order is the order they are offered in; createdAt carries it.
    const createdAt = new Date(now.getTime() + i).toISOString();
    const [row] = await d
      .insert(scenarios)
      .values({ slug: e.slug, title: e.title, brief: e.brief, domains: e.domains, origin: "seed", createdAt })
      .onConflictDoUpdate({ target: scenarios.slug, set: { title: e.title, brief: e.brief, domains: e.domains } })
      .returning({ id: scenarios.id, title: scenarios.title });
    const [first] = await d.select({ id: scenarioVisits.id }).from(scenarioVisits).where(eq(scenarioVisits.scenarioId, row.id)).orderBy(asc(scenarioVisits.n)).limit(1);
    if (first) continue;
    await storeVisit(d, row, 1, e.visit, now);
    visitsWritten++;
  }

  // Tag every seeded bundle atom with its scenarios' domains, for prompts written later.
  for (const e of entries) {
    const keys = e.visit.bundle.filter((b) => b.type !== "grammar").map((b) => b.key);
    const rows = await d.select({ id: atoms.id, domains: atoms.domains }).from(atoms).where(inArray(atoms.key, keys));
    for (const r of rows) {
      const domains = Array.from(new Set([...r.domains, ...e.domains]));
      if (domains.length !== r.domains.length) await d.update(atoms).set({ domains }).where(eq(atoms.id, r.id));
    }
  }
  return { scenarios: entries.length, visitsWritten };
}
