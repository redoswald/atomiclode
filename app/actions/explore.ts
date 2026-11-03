"use server";

import { learner } from "@/lib/learner";
import { hasAnthropicKey } from "@/lib/llm/client";
import { explore } from "@/lib/llm/explore";

export async function ask(question: string): Promise<{ answer?: string; error?: string }> {
  const me = await learner();
  const q = question.trim().slice(0, 1000);
  if (!q) return { error: "Ask something first." };
  if (!hasAnthropicKey()) return { error: "Set ANTHROPIC_API_KEY in Vercel to enable Explore." };
  try {
    return { answer: await explore(q, me.lang) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
