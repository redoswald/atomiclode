/**
 * What orders new atoms (SPEC §4.2): the bundles of scenario visits in progress
 * and the active goal text's unknowns. Foundation phase puts scenarios first,
 * reading phase the goal. Hand-mined atoms outrank both inside the scheduler.
 */
import type { Db } from "@/db";
import { currentPhase, type Phase } from "@/lib/atoms/phase";
import { goalNewOrder } from "@/lib/goals/goals";
import { hasAnthropicKey } from "@/lib/llm/client";
import { scenarioNewOrder, scenariosLead, scenarioStates } from "@/lib/scenarios/visits";

export interface NewOrder {
  phase: Phase;
  newOrder: string[];
  /** Foundation phase with a scenario visit under way or on offer: no bare frequency-list words. */
  noFrequencyFallback: boolean;
}

export async function newAtomOrder(d: Db, canGenerate = hasAnthropicKey()): Promise<NewOrder> {
  const [{ phase }, fromScenarios, fromGoal, states] = await Promise.all([currentPhase(d), scenarioNewOrder(d), goalNewOrder(d), scenarioStates(d)]);
  // In the foundation phase the goal only steers which words scenarios pick up (SPEC §11).
  const newOrder = phase === "reading" ? [...fromGoal, ...fromScenarios] : fromScenarios;
  return {
    phase,
    newOrder: Array.from(new Set(newOrder)),
    noFrequencyFallback: phase === "foundation" && scenariosLead(states, canGenerate),
  };
}
