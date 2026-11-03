/** XP rules (SPEC §18). Pure, and safe in the browser. */
import type { Modality } from "@/lib/atoms/types";
import { MODALITY_SECONDS } from "@/lib/scheduler/modality";

export type XpKind = "review" | "lesson" | "refresh" | "scene" | "passage" | "goal-section";

/** XP per minute of focused work; review cards earn by their time. */
export const XP_PER_MINUTE = 2;
export const XP = {
  lesson: 20,
  lessonClean: 5,
  lessonReplay: 5,
  refresh: 5,
  scene: 15,
  passage: 5,
  goalSection: 10,
} as const;

export const DAILY_GOALS = [
  { xp: 20, label: "Casual", minutes: 10 },
  { xp: 40, label: "Steady", minutes: 20 },
  { xp: 80, label: "Serious", minutes: 40 },
] as const;

/** A review card's XP: its expected seconds at 2 XP a minute (a five-minute round is about 10). */
export function reviewXp(modality: Modality): number {
  return Math.round(((MODALITY_SECONDS[modality] * XP_PER_MINUTE) / 60) * 100) / 100;
}
