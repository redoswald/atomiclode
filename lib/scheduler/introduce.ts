/**
 * The state an atom starts in when a lesson hands it to review (SPEC §17): what
 * FSRS gives a new card after one rating (Good if the learner got it right first
 * time all lesson, Hard if not), with the first review moved to `due` (a later
 * day, spread when a day is heavy). Not a graded review: nothing is added to the
 * review log or the modality counters.
 */
import type { MemoryState } from "@/lib/atoms/types";
import { newMemoryState } from "@/lib/atoms/types";
import { cardToMemory, memoryToCard, Rating, scheduler } from "./fsrs";

export interface Introduction {
  atomId: string;
  at: string;
  due: string;
  firstTimeRight: boolean;
}

export function introducedMemoryState(intro: Pick<Introduction, "at" | "due" | "firstTimeRight">): MemoryState {
  // Timestamps may arrive in the database's own text form; keep them as ISO strings.
  const at = new Date(intro.at).toISOString();
  const fresh = newMemoryState(at);
  const card = scheduler.next(memoryToCard(fresh), new Date(at), intro.firstTimeRight ? Rating.Good : Rating.Hard).card;
  const m = cardToMemory(card, fresh);
  return { ...m, due: new Date(intro.due).toISOString(), lastReview: at };
}

const DAY_MS = 86_400_000;
/** More first reviews than this on one day and the rest move to the next (SPEC §17 Pacing). */
export const FIRST_REVIEWS_PER_DAY = 15;

/**
 * First-review dates for `count` items introduced at `at`, in teaching order: the
 * next day, unless that day already holds `perDay` first reviews, in which case
 * they spill onto the following days. `existing` counts first reviews already
 * booked per UTC day (YYYY-MM-DD).
 */
export function spreadFirstReviews(at: Date, count: number, existing: Map<string, number>, perDay = FIRST_REVIEWS_PER_DAY): string[] {
  const booked = new Map(existing);
  const out: string[] = [];
  let day = 1;
  for (let i = 0; i < count; i++) {
    for (;;) {
      const d = new Date(at.getTime() + day * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      const n = booked.get(key) ?? 0;
      if (n < perDay) {
        booked.set(key, n + 1);
        out.push(d.toISOString());
        break;
      }
      day++;
    }
  }
  return out;
}
