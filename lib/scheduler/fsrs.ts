/**
 * Thin wrapper around ts-fsrs: converts between our MemoryState and an FSRS
 * Card, and exposes one scheduler instance with published default parameters.
 */
import { fsrs, generatorParameters, Rating, State, type Card, type Grade as FsrsGrade } from "ts-fsrs";
import type { Grade, MemoryState, MemoryStatus } from "@/lib/atoms/types";

/** Default FSRS parameters. Fuzz off so replaying the log is deterministic. */
export const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

export function toRating(grade: Grade): FsrsGrade {
  return grade as unknown as FsrsGrade; // 1–4 maps onto Rating.Again..Easy
}

function toState(m: MemoryState): State {
  switch (m.status) {
    case "new":
      return State.New;
    case "learning":
      // A card is only ever in Learning before its first graduation; any later
      // learning phase is a Relearning after a lapse.
      return m.lapses > 0 ? State.Relearning : State.Learning;
    case "review":
    case "suspended":
      return m.reps === 0 ? State.New : State.Review;
  }
}

function toStatus(state: State): MemoryStatus {
  switch (state) {
    case State.New:
      return "new";
    case State.Learning:
    case State.Relearning:
      return "learning";
    case State.Review:
      return "review";
  }
}

export function memoryToCard(m: MemoryState): Card {
  return {
    due: new Date(m.due),
    stability: m.stability,
    difficulty: m.difficulty,
    elapsed_days: 0,
    scheduled_days: m.scheduledDays,
    learning_steps: m.learningSteps,
    reps: m.reps,
    lapses: m.lapses,
    state: toState(m),
    last_review: m.lastReview ? new Date(m.lastReview) : undefined,
  };
}

export function cardToMemory(card: Card, previous: MemoryState): MemoryState {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.due.toISOString(),
    lastReview: card.last_review?.toISOString() ?? previous.lastReview,
    reps: card.reps,
    lapses: card.lapses,
    status: previous.status === "suspended" ? "suspended" : toStatus(card.state),
    learningSteps: card.learning_steps,
    scheduledDays: card.scheduled_days,
  };
}

export { Rating, State };
