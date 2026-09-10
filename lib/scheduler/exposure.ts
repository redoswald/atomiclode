/**
 * Exposure signals from the reader (SPEC §4). Pure.
 *
 * - An untapped encounter with a known atom bumps stability a little; the
 *   bump is capped between reviews and never moves the due date, so it can
 *   never skip a review.
 * - A known atom tapped 3+ times in 7 days is fragile: its due date is
 *   pulled forward to now so it comes up in the next session.
 */
import type { Atom, Encounter } from "@/lib/atoms/types";

export const UNTAPPED_BUMP = 0.03; // +3% stability per untapped encounter
export const UNTAPPED_CAP = 0.15; // at most +15% between two reviews
export const FRAGILE_TAPS = 3;
export const FRAGILE_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

export interface ExposureResult {
  atom: Atom;
  fragile: boolean;
}

/**
 * Apply the encounters that happened after the atom's last review.
 * `encounters` may include other atoms' events; they are ignored.
 */
export function applyExposure(atom: Atom, encounters: Encounter[], now: string): ExposureResult {
  const m = atom.memory;
  if (m.status !== "learning" && m.status !== "review") return { atom, fragile: false };
  const since = m.lastReview ?? atom.createdAt;
  const nowMs = new Date(now).getTime();
  const mine = encounters.filter((e) => e.atomId === atom.id && e.at > since && new Date(e.at).getTime() <= nowMs);
  if (mine.length === 0) return { atom, fragile: false };

  const untapped = mine.filter((e) => !e.tapped).length;
  const bump = Math.min(UNTAPPED_CAP, untapped * UNTAPPED_BUMP);
  // Bump relative to the stability set at the last review, so repeated calls don't compound.
  const base = m.scheduledDays > 0 ? m.scheduledDays : m.stability;
  let stability = Math.max(m.stability, base * (1 + bump));

  const windowStart = nowMs - FRAGILE_WINDOW_DAYS * DAY_MS;
  const taps = mine.filter((e) => e.tapped && new Date(e.at).getTime() >= windowStart).length;
  const fragile = taps >= FRAGILE_TAPS;
  let due = m.due;
  if (fragile) {
    stability = m.stability; // a word you keep looking up has not gotten stronger
    if (new Date(due).getTime() > nowMs) due = now;
  }

  if (stability === m.stability && due === m.due) return { atom, fragile };
  return { atom: { ...atom, memory: { ...m, stability, due } }, fragile };
}

/** Atoms the learner keeps tapping: fragile even without a scheduler pass. */
export function isFragile(atom: Atom, encounters: Encounter[], now: string): boolean {
  return applyExposure(atom, encounters, now).fragile;
}
