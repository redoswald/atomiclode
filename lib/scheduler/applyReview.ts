import type { Atom, ReviewEvent } from "@/lib/atoms/types";
import { emptyModalityStats } from "@/lib/atoms/types";
import { cardToMemory, memoryToCard, Rating, scheduler, State, toRating } from "./fsrs";
import { bestEstablished, hardness } from "./modality";

/** Recognize-only Easy answers cannot push stability past this until recall is tested. */
export const RECOGNIZE_ONLY_CEILING_DAYS = 30;
/** Suspend as a leech after this many lapses. */
export const LEECH_LAPSES = 8;

const DAY_MS = 86_400_000;

/**
 * Pure. Applies one review event to an atom's memory state and modality counters.
 * Standard FSRS update, then the modality rules from SPEC §4.
 */
export function applyReview(atom: Atom, event: ReviewEvent): Atom {
  if (event.atomId !== atom.id) {
    throw new Error(`applyReview: event for ${event.atomId} applied to atom ${atom.id}`);
  }
  const now = new Date(event.at);
  const card = memoryToCard(atom.memory);
  const stats = { ...emptyModalityStats(), ...atom.modality };

  // A fail in a harder modality than the atom's best-established one is a
  // weaker skill, not a forgotten word: grade it Hard and refuse stability growth.
  const best = bestEstablished(stats);
  const softFail = event.grade === 1 && best !== undefined && hardness(event.modality) > hardness(best);

  let next = softFail
    ? scheduler.next(card, now, Rating.Hard).card
    : scheduler.next(card, now, toRating(event.grade)).card;

  if (softFail && card.state === State.Review && next.stability > card.stability) {
    const interval = Math.max(1, scheduler.next_interval(card.stability, elapsedDays(card, now)));
    next = {
      ...next,
      stability: card.stability,
      scheduled_days: interval,
      due: new Date(now.getTime() + interval * DAY_MS),
    };
  }

  // Easy on recognize alone cannot push stability past a ceiling until recall has been tested.
  if (
    event.modality === "recognize" &&
    event.grade === 4 &&
    stats.recall.attempts === 0 &&
    next.stability > RECOGNIZE_ONLY_CEILING_DAYS
  ) {
    const cappedDue = new Date(now.getTime() + RECOGNIZE_ONLY_CEILING_DAYS * DAY_MS);
    next = {
      ...next,
      stability: RECOGNIZE_ONLY_CEILING_DAYS,
      scheduled_days: RECOGNIZE_ONLY_CEILING_DAYS,
      due: next.due < cappedDue ? next.due : cappedDue,
    };
  }

  const memory = cardToMemory(next, atom.memory);
  if (memory.lapses >= LEECH_LAPSES) memory.status = "suspended";

  const stat = stats[event.modality];
  stats[event.modality] = {
    attempts: stat.attempts + 1,
    correct: stat.correct + (event.grade >= 3 ? 1 : 0),
    lastAt: event.at,
  };

  return { ...atom, memory, modality: stats };
}

function elapsedDays(card: { last_review?: Date }, now: Date): number {
  return card.last_review ? Math.max(0, (now.getTime() - card.last_review.getTime()) / DAY_MS) : 0;
}
