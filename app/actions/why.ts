"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { learner } from "@/lib/learner";
import { hasAnthropicKey } from "@/lib/llm/client";
import { addGrammarAtom, askWhy, type WhyAnswer, type WhyRequest } from "@/lib/reader/why";

export type WhyResponse = (WhyAnswer & { error?: undefined }) | { error: string };

export async function why(req: WhyRequest): Promise<WhyResponse> {
  const me = await learner();
  if (!hasAnthropicKey()) return { error: "Set ANTHROPIC_API_KEY in Vercel to enable explanations." };
  try {
    return await askWhy(db(), me, req);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function addGrammar(input: { key: string; title: string; explanation: string; fromAtomId?: string }) {
  const me = await learner();
  const result = await addGrammarAtom(db(), me, input);
  revalidatePath("/");
  return result;
}
