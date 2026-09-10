"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireAuth } from "@/lib/auth";
import { hasAnthropicKey } from "@/lib/llm/client";
import { GENRES, type Genre } from "@/lib/llm/generate";
import { dueLemmas, reuseOrGenerate } from "@/lib/reader/library";

/** Form action for /read: serve a matching passage from the library or generate one. */
export async function generateOrReuse(formData: FormData): Promise<void> {
  await requireAuth();
  const genre = parseGenre(formData.get("genre"));
  const stretch = Number(formData.get("stretch"));
  const targetCoverage = Number.isFinite(stretch) ? Math.min(0.98, Math.max(0.9, stretch / 100)) : 0.95;
  const topic = String(formData.get("topic") ?? "").trim() || undefined;
  const includeDue = formData.get("includeDue") === "on";

  let id: string;
  let reused: boolean;
  try {
    const d = db();
    const mustInclude = includeDue ? await dueLemmas(d) : [];
    ({ id, reused } = await reuseOrGenerate(d, { targetCoverage, genre, topic, mustInclude }));
  } catch (err) {
    const message = !hasAnthropicKey() ? "Set ANTHROPIC_API_KEY in Vercel to generate passages." : err instanceof Error ? err.message : String(err);
    redirect(`/read?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/");
  redirect(`/read/${id}${reused ? "?reused=1" : ""}`);
}

function parseGenre(v: FormDataEntryValue | null): Genre {
  const s = typeof v === "string" ? v : "";
  return (GENRES as readonly string[]).includes(s) ? (s as Genre) : "short story";
}
