/** The course (SPEC §17): a locked path of units and lessons that introduce words. */
import type { Lang } from "@/lib/lang";

export interface Course {
  lang: Lang;
  units: Unit[];
}

export interface Unit {
  id: string;
  cefr: string;
  title: string;
  canDo: string[];
  /** Scenario slugs that open with this unit; the first is its checkpoint. */
  scenes: string[];
  lessons: Lesson[];
}

export type LessonKind = "letters" | "phrases" | "checkpoint";

export interface Lesson {
  id: string;
  title: string;
  kind: LessonKind;
  /** Script units this lesson teaches (Greek). */
  letters?: string[];
  /** Sound rules this lesson teaches beyond its letters (see reading.ts). */
  rules?: SoundRule[];
  items: LessonItem[];
  /** Checkpoint: the scenario slug played as the unit's test. */
  scene?: string;
}

export interface LessonItem {
  /** Atom key (word or chunk). */
  key: string;
  /**
   * sight: its spelling doesn't follow the rules taught so far (γεια); never a sound-it-out card.
   * heard: a phrase met by ear before its letters are taught; sound-it-out waits until it is readable.
   */
  mode?: "sight" | "heard";
}

/**
 * Context rules that are taught separately from the letters themselves. The
 * positional sounds of μπ / ντ / γκ and the ef / af of ευ / αυ come with those
 * units; these are the ones a unit can still lack.
 */
export type SoundRule = "gamma-front" | "gamma-chi";
