"use server";

import { db } from "@/db";
import { requireAuth } from "@/lib/auth";
import { recordReview, type RecordReviewInput, type RecordReviewResult } from "@/lib/review/record";

export type { RecordReviewInput as SubmitReviewInput, RecordReviewResult as SubmitReviewResult };

export async function submitReview(input: RecordReviewInput): Promise<RecordReviewResult> {
  await requireAuth();
  return recordReview(db(), input);
}
