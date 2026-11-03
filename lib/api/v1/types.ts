/**
 * API v1 response shapes (SPEC §19): the contract the iOS app mirrors as Swift
 * Codable structs. Additive changes only within v1: fields may be added, never
 * removed or changed in meaning. Contract fixtures (lib/api/v1/fixtures) are
 * built from these by `npm run api:fixtures` and checked by the tests.
 */
import type { Modality } from "@/lib/atoms/types";
import type { Exercise, ItemStats, LessonItemView } from "@/lib/course/exercises";
import type { LessonPayload, LessonResult } from "@/lib/course/lesson";
import type { LessonState } from "@/lib/course/path";
import type { Lesson } from "@/lib/course/types";
import type { Lang } from "@/lib/lang";
import type { Streak } from "@/lib/progress/xp";
import type { ProduceCheck } from "@/lib/review/produce";
import type { RecordReviewResult } from "@/lib/review/record";
import type { Intensity } from "@/lib/scheduler";
import type { SessionCard } from "@/lib/review/session";

export type { Exercise, ItemStats, LessonItemView, LessonPayload, LessonResult, ProduceCheck, RecordReviewResult, SessionCard };

export interface MeResponse {
  user: { id: string; email: string; name: string | null };
  lang: Lang;
  tracks: Array<{ lang: Lang; name: string; nativeName: string; courseLive: boolean }>;
  settings: { dailyGoal: number; timeZone: string };
  dailyGoals: Array<{ xp: number; label: string; minutes: number }>;
  /** The learner's local day, YYYY-MM-DD. */
  today: string;
  todayXp: number;
  totalXp: number;
  streak: Streak;
}

export interface PathLesson {
  id: string;
  n: number;
  title: string;
  kind: Lesson["kind"];
  state: LessonState;
  faded: boolean;
  letters: string[];
  preview: string[];
  /** A checkpoint's scene, to open with GET /scenes/:id. */
  sceneId: string | null;
}

export interface PathResponse {
  lang: Lang;
  /** False while the track has no live course (French today). */
  live: boolean;
  units: Array<{
    id: string;
    cefr: string;
    title: string;
    canDo: string[];
    progress: { done: number; total: number };
    level: { name: string; share: number };
    lessons: PathLesson[];
  }>;
}

export interface ReviewRound {
  round: number;
  intensity: Intensity;
  minutes: number;
  /** Each card's `modality` is one the client listed (SPEC §19). */
  cards: SessionCard[];
  left: { cards: number; minutes: number; rounds: number };
  deferred: number;
}

export interface SceneResponse {
  lang: Lang;
  scenario: { id: string; slug: string; title: string; brief: string };
  visit: null | {
    id: string;
    n: number;
    of: number;
    brief: string;
    lines: Array<{ text: string; voice: 0 | 1; translation: string | null }>;
    bundle: Array<{ atomId: string; display: string; gloss: string; romanization: string | null; speak: string | null; status: string }>;
    prompts: Array<{ id: string; situation: string; exampleAnswer: string }>;
    /** Set when this scene is the checkpoint the learner is on. */
    checkpointLessonId: string | null;
  };
}

export type ReviewResult = RecordReviewResult & { xp: number; clamped: boolean };
export type LessonCompleteResult =
  | ({ kind: "lesson"; xp: number; clamped: boolean } & LessonResult)
  | { kind: "refresh"; reviewed: number; xp: number; clamped: boolean };
export type CardModality = Modality;
