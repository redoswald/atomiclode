/** Validate every course against its track's seed files (tests and db:prepare). */
import { COURSES } from "./index";
import { validateCourse } from "./validate";
import { SEEDS } from "@/lib/learners/provision";
import type { Lang } from "@/lib/lang";

export function courseProblems(): string[] {
  const out: string[] = [];
  for (const [lang, course] of Object.entries(COURSES) as Array<[Lang, NonNullable<(typeof COURSES)[Lang]>]>) {
    const seed = SEEDS[lang];
    const entries = [
      ...seed.files.freq.map((w) => ({ key: w.lemma, romanization: w.romanization })),
      ...seed.files.chunks.map((c) => ({ key: c.key, romanization: c.romanization })),
    ];
    out.push(...validateCourse(course, entries, seed.scenarios.map((s) => s.slug)).map((p) => `${lang}: ${p}`));
  }
  return out;
}
