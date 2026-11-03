"use server";

import { db } from "@/db";
import { learner } from "@/lib/learner";
import { hasAnthropicKey } from "@/lib/llm/client";
import { checkProduce, recordProduce, type ProduceCheck, type RecordProduceInput } from "@/lib/review/produce";
import { recordReview, type RecordReviewInput, type RecordReviewResult } from "@/lib/review/record";

export type { RecordReviewInput as SubmitReviewInput, RecordReviewResult as SubmitReviewResult };

export async function submitReview(input: RecordReviewInput): Promise<RecordReviewResult> {
  const me = await learner();
  return recordReview(db(), me.userId, input);
}

/** Check a free-text answer to a produce prompt. Nothing is logged until the learner confirms a grade. */
export async function checkProduceAnswer(input: { promptId: string; answer: string }): Promise<ProduceCheck | { error: string }> {
  const me = await learner();
  if (!hasAnthropicKey()) return { error: "Set ANTHROPIC_API_KEY to have answers checked." };
  try {
    return await checkProduce(db(), me.userId, input.promptId, input.answer);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function submitProduce(input: RecordProduceInput): Promise<RecordReviewResult> {
  const me = await learner();
  return recordProduce(db(), me.userId, input);
}
