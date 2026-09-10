"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireAuth } from "@/lib/auth";
import { hasAnthropicKey } from "@/lib/llm/client";
import { LEVELS, type Level } from "@/lib/llm/adapt";
import { adaptPassage } from "@/lib/reader/library";

/** Form action on a passage page: rewrite it at a level and open the result. */
export async function adapt(formData: FormData): Promise<void> {
  await requireAuth();
  const passageId = String(formData.get("passageId") ?? "");
  const level = String(formData.get("level") ?? "balanced") as Level;
  if (!(level in LEVELS) || !/^[0-9a-f-]{36}$/i.test(passageId)) redirect("/read");

  let id: string;
  let reused: boolean;
  try {
    ({ id, reused } = await adaptPassage(db(), passageId, level));
  } catch (err) {
    const message = !hasAnthropicKey() ? "Set ANTHROPIC_API_KEY in Vercel to adapt texts." : err instanceof Error ? err.message : String(err);
    redirect(`/read/${passageId}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/read");
  redirect(`/read/${id}${reused ? "?reused=1" : ""}`);
}
