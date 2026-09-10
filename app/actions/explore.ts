"use server";

import { requireAuth } from "@/lib/auth";
import { hasAnthropicKey } from "@/lib/llm/client";
import { explore } from "@/lib/llm/explore";

export async function ask(question: string): Promise<{ answer?: string; error?: string }> {
  await requireAuth();
  const q = question.trim().slice(0, 1000);
  if (!q) return { error: "Ask something first." };
  if (!hasAnthropicKey()) return { error: "Set ANTHROPIC_API_KEY in Vercel to enable Explore." };
  try {
    return { answer: await explore(q) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
