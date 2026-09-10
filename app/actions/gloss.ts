"use server";

import { and, asc, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { atoms } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { hasAnthropicKey } from "@/lib/llm/client";
import { glossLemmas } from "@/lib/llm/gloss";

export interface GlossBatchResult {
  filled: number;
  remaining: number;
  error?: string;
}

const BATCH = 40;

/** Gloss the next batch of unglossed word atoms, most frequent first. */
export async function glossNextBatch(): Promise<GlossBatchResult> {
  await requireAuth();
  if (!hasAnthropicKey()) {
    return { filled: 0, remaining: await unglossedCount(), error: "ANTHROPIC_API_KEY is not set." };
  }
  const d = db();
  const todo = await d
    .select({ id: atoms.id, lemma: atoms.key, pos: atoms.pos, gender: atoms.gender })
    .from(atoms)
    .where(and(eq(atoms.type, "word"), eq(atoms.gloss, "")))
    .orderBy(asc(atoms.frequencyRank))
    .limit(BATCH);
  if (todo.length === 0) return { filled: 0, remaining: 0 };

  let glosses: Map<string, string>;
  try {
    glosses = await glossLemmas(todo);
  } catch (err) {
    return { filled: 0, remaining: await unglossedCount(), error: err instanceof Error ? err.message : String(err) };
  }
  let filled = 0;
  for (const row of todo) {
    const gloss = glosses.get(row.lemma);
    if (!gloss) continue;
    await d.update(atoms).set({ gloss }).where(eq(atoms.id, row.id));
    filled++;
  }
  revalidatePath("/");
  return { filled, remaining: await unglossedCount() };
}

async function unglossedCount(): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(atoms)
    .where(sql`${atoms.type} = 'word' and ${atoms.gloss} = ''`);
  return row?.n ?? 0;
}
