"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { currentPhase } from "@/lib/atoms/phase";
import { requireAuth } from "@/lib/auth";
import { activate, goalLemmasForScenarios, pinGoal, prepareGoal, rungGate } from "@/lib/goals/goals";
import { LEVELS, type Level } from "@/lib/llm/adapt";
import { hasAnthropicKey } from "@/lib/llm/client";
import { adaptPassage } from "@/lib/reader/library";
import { createCustomScenario } from "@/lib/scenarios/generate";
import { goals } from "@/db/schema";
import { eq } from "drizzle-orm";

const UUID = /^[0-9a-f-]{36}$/i;
const NO_KEY = "Set ANTHROPIC_API_KEY in Vercel for this.";
const message = (err: unknown) => (!hasAnthropicKey() ? NO_KEY : err instanceof Error ? err.message : String(err));

/** Form action on a passage page: "Make this my goal". */
export async function pin(formData: FormData): Promise<void> {
  await requireAuth();
  const passageId = String(formData.get("passageId") ?? "");
  if (!UUID.test(passageId)) redirect("/read");
  let id: string;
  try {
    id = await pinGoal(db(), passageId);
  } catch (err) {
    redirect(`/read/${passageId}?error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
  revalidatePath("/");
  redirect(`/goal/${id}`);
}

export async function makeActive(formData: FormData): Promise<void> {
  await requireAuth();
  const goalId = String(formData.get("goalId") ?? "");
  if (UUID.test(goalId)) await activate(db(), goalId);
  revalidatePath("/");
  redirect(`/goal/${goalId}`);
}

/** Gloss the goal's words and survey its grammar (two model calls, run together). */
export async function prepare(formData: FormData): Promise<void> {
  await requireAuth();
  const goalId = String(formData.get("goalId") ?? "");
  if (!UUID.test(goalId)) redirect("/goal");
  try {
    await prepareGoal(db(), goalId);
  } catch (err) {
    redirect(`/goal/${goalId}?error=${encodeURIComponent(message(err))}`);
  }
  revalidatePath("/");
  redirect(`/goal/${goalId}`);
}

/** Write (or rewrite, when stale) one rung of the ladder for one section, and open it. */
export async function writeRung(formData: FormData): Promise<void> {
  await requireAuth();
  const goalId = String(formData.get("goalId") ?? "");
  const passageId = String(formData.get("passageId") ?? "");
  // "balanced!" asks for a stale rung to be rewritten.
  const raw = String(formData.get("level") ?? "");
  const refresh = raw.endsWith("!");
  const level = raw.replace(/!$/, "") as Level;
  if (!UUID.test(goalId) || !UUID.test(passageId) || !(level in LEVELS)) redirect("/goal");
  let id: string;
  try {
    const d = db();
    const { phase, knownWords } = await currentPhase(d);
    const gate = rungGate(level, knownWords, phase);
    if (gate) throw new Error(gate);
    ({ id } = await adaptPassage(d, passageId, level, undefined, { refresh }));
  } catch (err) {
    redirect(`/goal/${goalId}?error=${encodeURIComponent(message(err))}`);
  }
  redirect(`/read/${id}`);
}

/** Spin one of the survey's scene ideas out as a goal scenario (SPEC §10). */
export async function sceneFromGoal(formData: FormData): Promise<void> {
  await requireAuth();
  const goalId = String(formData.get("goalId") ?? "");
  const idx = Number(formData.get("idea"));
  if (!UUID.test(goalId)) redirect("/goal");
  let scenarioId: string;
  try {
    const d = db();
    const [goal] = await d.select().from(goals).where(eq(goals.id, goalId));
    const idea = goal?.sceneIdeas[idx];
    if (!idea) throw new Error("That scene idea is gone.");
    ({ scenarioId } = await createCustomScenario(d, idea, { origin: "goal", goalId, goalLemmas: await goalLemmasForScenarios(d) }));
    await d.update(goals).set({ sceneIdeas: goal.sceneIdeas.filter((_, i) => i !== idx) }).where(eq(goals.id, goalId));
  } catch (err) {
    redirect(`/goal/${goalId}?error=${encodeURIComponent(message(err))}`);
  }
  revalidatePath("/");
  redirect(`/scenario/${scenarioId}`);
}
