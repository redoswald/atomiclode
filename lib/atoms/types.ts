/**
 * Core learner-model types. See SPEC.md §3.
 *
 * These are the in-memory shapes the scheduler and UI work with. The database
 * rows in `db/schema.ts` map onto them one-to-one via `lib/atoms/rows.ts`.
 */

export type AtomType = "word" | "chunk" | "grammar";

export type AtomSource = "frequency" | "mined" | "conversation" | "manual";

/** Free-form topic tag, e.g. "travel", "food". Empty list = general. */
export type Domain = string;

export type Modality =
  | "recognize" // FR → EN
  | "recall" // EN → FR, typed
  | "listen" // audio → meaning (v2; field reserved)
  | "produce" // use in a sentence
  | "cloze"; // fill the gap in a mined sentence

export const MODALITIES: readonly Modality[] = [
  "recognize",
  "recall",
  "listen",
  "produce",
  "cloze",
] as const;

export type MemoryStatus = "new" | "learning" | "review" | "suspended";

export interface MemoryState {
  stability: number; // days until recall prob ~90%
  difficulty: number; // 1–10
  due: string; // ISO timestamp
  lastReview?: string;
  reps: number;
  lapses: number;
  status: MemoryStatus;
  /** FSRS bookkeeping (not in SPEC §3): position within (re)learning steps and last scheduled interval. */
  learningSteps: number;
  scheduledDays: number;
}

export interface ModalityStat {
  attempts: number;
  correct: number;
  lastAt?: string;
}

export interface Atom {
  id: string;
  lang: "fr";
  type: AtomType;

  // word: lemma ("vouloir"); chunk: fixed phrase ("je voudrais");
  // grammar: short slug ("conditional-polite-request")
  key: string;
  forms: string[]; // surface forms seen: "voudrais", "voudrait"
  gloss: string; // short L1 meaning
  explanation?: string; // the "why?" text, cached once generated
  pos?: string; // word/chunk only
  gender?: "m" | "f"; // nouns only; not in SPEC §3, added for French articles
  frequencyRank?: number; // from a frequency list, if known
  domains: Domain[];
  relatedAtoms: string[]; // word → grammar it depends on, chunk → its words

  memory: MemoryState;
  modality: Record<Modality, ModalityStat>;

  createdAt: string;
  source: AtomSource;
  /** Set by "Already know" in the reader; replay starts such atoms from a mature state. */
  markedKnownAt?: string;
}

export type SentenceOrigin = "generated" | "imported" | "conversation";

export interface Sentence {
  id: string;
  text: string;
  translation?: string;
  audioUrl?: string; // reserved
  atomIds: string[]; // every atom present, known or not
  origin: SentenceOrigin;
  sourceRef?: string; // article URL, doc id, etc.
}

export type Grade = 1 | 2 | 3 | 4; // again / hard / good / easy

/** Append-only. Memory state is a cache derived from replaying these. */
export interface ReviewEvent {
  atomId: string;
  modality: Modality;
  sentenceId?: string;
  grade: Grade;
  responseMs: number;
  at: string;
}

export interface Encounter {
  atomId: string;
  sentenceId: string;
  passageId: string;
  at: string;
  tapped: boolean;
}

export function emptyModalityStats(): Record<Modality, ModalityStat> {
  return {
    recognize: { attempts: 0, correct: 0 },
    recall: { attempts: 0, correct: 0 },
    listen: { attempts: 0, correct: 0 },
    produce: { attempts: 0, correct: 0 },
    cloze: { attempts: 0, correct: 0 },
  };
}

/** Memory state for an atom that has never been reviewed. Due now. */
export function newMemoryState(now: string): MemoryState {
  return {
    stability: 0,
    difficulty: 0,
    due: now,
    reps: 0,
    lapses: 0,
    status: "new",
    learningSteps: 0,
    scheduledDays: 0,
  };
}
