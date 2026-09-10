/** Reading time at a learner's pace (~140 words per minute). */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 140));
}
