"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireAuth } from "@/lib/auth";
import { goalLemmasForScenarios } from "@/lib/goals/goals";
import { hasAnthropicKey } from "@/lib/llm/client";
import { checkProduce, type ProduceCheck } from "@/lib/review/produce";
import { createCustomScenario, generateNextVisit } from "@/lib/scenarios/generate";

const NO_KEY = "Set ANTHROPIC_API_KEY in Vercel to write new visits.";

/** Form action: write the next visit of a scenario and open it. */
export async function nextVisit(formData: FormData): Promise<void> {
  await requireAuth();
  const scenarioId = String(formData.get("scenarioId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(scenarioId)) redirect("/scenario");
  let n: number;
  try {
    const d = db();
    ({ n } = await generateNextVisit(d, scenarioId, { goalLemmas: await goalLemmasForScenarios(d) }));
  } catch (err) {
    const message = !hasAnthropicKey() ? NO_KEY : err instanceof Error ? err.message : String(err);
    redirect(`/scenario/${scenarioId}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/");
  redirect(`/scenario/${scenarioId}?visit=${n}`);
}

/** Form action: a scenario from the learner's own words. */
export async function createScenario(formData: FormData): Promise<void> {
  await requireAuth();
  const situation = String(formData.get("situation") ?? "");
  let scenarioId: string;
  try {
    const d = db();
    ({ scenarioId } = await createCustomScenario(d, situation, { goalLemmas: await goalLemmasForScenarios(d) }));
  } catch (err) {
    const message = !hasAnthropicKey() ? NO_KEY : err instanceof Error ? err.message : String(err);
    redirect(`/scenario?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/");
  redirect(`/scenario/${scenarioId}`);
}

/** "Your turn" on a visit: checked like a produce card, but a rehearsal. Nothing is logged (SPEC §10). */
export async function rehearse(input: { promptId: string; answer: string }): Promise<ProduceCheck | { error: string }> {
  await requireAuth();
  if (!hasAnthropicKey()) return { error: "Set ANTHROPIC_API_KEY to have answers checked. Compare with the example instead." };
  try {
    return await checkProduce(db(), input.promptId, input.answer);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
