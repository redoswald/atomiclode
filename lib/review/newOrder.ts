/**
 * What orders new atoms (SPEC §4.2): the bundles of scenario visits in progress
 * and the active goal text's unknowns. Foundation phase puts scenarios first,
 * reading phase the goal. Hand-mined atoms outrank both inside the scheduler.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms } from "@/db/schema";
import { currentPhase, type Phase } from "@/lib/atoms/phase";
import { courseLive } from "@/lib/course";
import { planScript } from "@/lib/greek/plan";
import type { Learner } from "@/lib/learners/provision";
import { goalNewOrder } from "@/lib/goals/goals";
import { hasAnthropicKey } from "@/lib/llm/client";
import { scenarioNewOrder, scenariosLead, scenarioStates } from "@/lib/scenarios/visits";

export interface NewOrder {
  phase: Phase;
  newOrder: string[];
  /** Foundation phase with a scenario visit under way or on offer: no bare frequency-list words. */
  noFrequencyFallback: boolean;
  /** New atoms the scheduler must not introduce yet (Greek words whose letters aren't in, SPEC §16). */
  blocked: string[];
}

/**
 * Greek is read before it is understood (SPEC §16): letters arrive by what they
 * unlock, and words wait for their letters. Scene and goal words still lead,
 * pulling in the letters they need.
 */
async function greekOrder(d: Db, me: Learner, lead: string[]): Promise<{ order: string[]; blocked: string[] }> {
  const rows = await d
    .select({
      id: atoms.id,
      key: atoms.key,
      type: atoms.type,
      status: atoms.status,
      pos: atoms.pos,
      domains: atoms.domains,
      frequencyRank: atoms.frequencyRank,
      gloss: atoms.gloss,
    })
    .from(atoms)
    .where(and(eq(atoms.userId, me.userId), eq(atoms.lang, me.lang)));
  return planScript(rows, lead);
}

export async function newAtomOrder(d: Db, me: Learner, canGenerate = hasAnthropicKey(), opts: { courseLive?: boolean } = {}): Promise<NewOrder> {
  const [{ phase }, fromScenarios, fromGoal, states] = await Promise.all([
    currentPhase(d, me),
    scenarioNewOrder(d, me),
    goalNewOrder(d, me),
    scenarioStates(d, me),
  ]);
  // In the foundation phase the goal only steers which words scenarios pick up (SPEC §11).
  const lead = Array.from(new Set(phase === "reading" ? [...fromGoal, ...fromScenarios] : fromScenarios));
  // A track with a live course (SPEC §17): the course introduces words, so review only
  // brings in what scenes, goals and the learner's own mining asked for.
  if (opts.courseLive ?? courseLive(me.lang)) return { phase, newOrder: lead, noFrequencyFallback: true, blocked: [] };
  const noFrequencyFallback = phase === "foundation" && scenariosLead(states, canGenerate);
  if (me.lang === "el") {
    const { order, blocked } = await greekOrder(d, me, lead);
    return { phase, newOrder: order, noFrequencyFallback, blocked };
  }
  return { phase, newOrder: lead, noFrequencyFallback, blocked: [] };
}
