/**
 * What orders new atoms (SPEC §4.2): the bundles of scenario visits in progress
 * and the active goal text's unknowns. Foundation phase puts scenarios first,
 * reading phase the goal. Hand-mined atoms outrank both inside the scheduler.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms } from "@/db/schema";
import { currentPhase, type Phase } from "@/lib/atoms/phase";
import type { Learner } from "@/lib/learners/provision";
import { goalNewOrder } from "@/lib/goals/goals";
import { hasAnthropicKey } from "@/lib/llm/client";
import { scenarioNewOrder, scenariosLead, scenarioStates } from "@/lib/scenarios/visits";

export interface NewOrder {
  phase: Phase;
  newOrder: string[];
  /** Foundation phase with a scenario visit under way or on offer: no bare frequency-list words. */
  noFrequencyFallback: boolean;
}

/**
 * A script comes before any scene: the Greek alphabet atoms (domain "alphabet")
 * lead the new-atom order while any of them is still new. French has none.
 */
async function primerOrder(d: Db, me: Learner): Promise<string[]> {
  const rows = await d
    .select({ id: atoms.id })
    .from(atoms)
    .where(and(eq(atoms.userId, me.userId), eq(atoms.lang, me.lang), eq(atoms.status, "new"), sql`'alphabet' = any(${atoms.domains})`))
    .orderBy(asc(atoms.frequencyRank));
  return rows.map((r) => r.id);
}

export async function newAtomOrder(d: Db, me: Learner, canGenerate = hasAnthropicKey()): Promise<NewOrder> {
  const [{ phase }, primer, fromScenarios, fromGoal, states] = await Promise.all([
    currentPhase(d, me),
    primerOrder(d, me),
    scenarioNewOrder(d, me),
    goalNewOrder(d, me),
    scenarioStates(d, me),
  ]);
  // In the foundation phase the goal only steers which words scenarios pick up (SPEC §11).
  const newOrder = [...primer, ...(phase === "reading" ? [...fromGoal, ...fromScenarios] : fromScenarios)];
  return {
    phase,
    newOrder: Array.from(new Set(newOrder)),
    noFrequencyFallback: phase === "foundation" && scenariosLead(states, canGenerate),
  };
}
