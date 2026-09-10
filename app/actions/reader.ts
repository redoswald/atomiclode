"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { contextGlosses, sentenceTranslations } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { hasAnthropicKey } from "@/lib/llm/client";
import { glossInContext } from "@/lib/llm/contextGloss";
import { fetchArticle } from "@/lib/reader/import";
import { createPassage, logTap, markKnown, mineWord } from "@/lib/reader/passages";

/** Form action for /read: paste text or give a URL, then open the passage. */
export async function importPassage(formData: FormData): Promise<void> {
  await requireAuth();
  const url = String(formData.get("url") ?? "").trim();
  const pasted = String(formData.get("text") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();

  let id: string;
  try {
    if (url) {
      const article = await fetchArticle(url);
      ({ id } = await createPassage(db(), { title: title || article.title, text: article.text, origin: "imported", sourceRef: article.sourceRef }));
    } else {
      ({ id } = await createPassage(db(), { title, text: pasted, origin: "imported" }));
    }
  } catch (err) {
    redirect(`/read?error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
  revalidatePath("/");
  redirect(`/read/${id}`);
}

export interface TapResult {
  gloss?: string;
  lemmaGloss?: string;
  translation?: string;
  /** Present when the gloss came from the model rather than the atom. */
  fromModel: boolean;
  error?: string;
}

/**
 * The learner tapped a word: log the exposure and return a gloss for this
 * sentence (cached per lemma + sentence; needs ANTHROPIC_API_KEY).
 */
export async function tapWord(input: {
  passageId: string;
  atomId?: string;
  lemma: string;
  surface: string;
  sentence: string;
}): Promise<TapResult> {
  await requireAuth();
  const d = db();
  if (input.atomId) await logTap(d, input.atomId, input.passageId);

  const [[cached], [tr]] = await Promise.all([
    d
      .select({ gloss: contextGlosses.gloss })
      .from(contextGlosses)
      .where(and(eq(contextGlosses.lemma, input.lemma), eq(contextGlosses.sentence, input.sentence))),
    d.select({ translation: sentenceTranslations.translation }).from(sentenceTranslations).where(eq(sentenceTranslations.sentence, input.sentence)),
  ]);
  if (cached && tr) return { gloss: cached.gloss, translation: tr.translation, fromModel: true };
  if (!hasAnthropicKey()) return { gloss: cached?.gloss, translation: tr?.translation, fromModel: false, error: "Set ANTHROPIC_API_KEY for in-context meanings." };

  try {
    const g = await glossInContext(input.lemma, input.surface, input.sentence);
    await Promise.all([
      d.insert(contextGlosses).values({ lemma: input.lemma, sentence: input.sentence, gloss: g.gloss }).onConflictDoNothing(),
      d.insert(sentenceTranslations).values({ sentence: input.sentence, translation: g.sentenceTranslation }).onConflictDoNothing(),
    ]);
    return { gloss: cached?.gloss ?? g.gloss, lemmaGloss: g.lemmaGloss, translation: tr?.translation ?? g.sentenceTranslation, fromModel: true };
  } catch (err) {
    return { fromModel: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function mine(input: { passageId: string; sentenceIdx: number; lemma: string; surface: string; gloss: string }) {
  await requireAuth();
  const result = await mineWord(db(), input);
  revalidatePath("/");
  return result;
}

export async function alreadyKnow(input: { lemma: string; surface: string; gloss: string }) {
  await requireAuth();
  const result = await markKnown(db(), input);
  revalidatePath("/");
  return result;
}
