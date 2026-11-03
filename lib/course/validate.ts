/**
 * Course validation (SPEC §17), run in tests and before every build: every
 * item resolves to a seed atom, nothing is introduced twice, a letters lesson
 * uses every letter it teaches, every item is readable with the letters taught
 * by the end of its lesson (unless heard first or a sight word), and every item
 * that isn't a sight word sounds out to its stored reading (decodable).
 */
import { scriptUnits } from "@/lib/greek/script";
import { predictReading, readingMatches } from "./reading";
import type { Course, SoundRule } from "./types";

export interface SeedEntry {
  key: string;
  romanization?: string;
}

export function validateCourse(course: Course, seed: SeedEntry[], scenes: string[] = []): string[] {
  const problems: string[] = [];
  const byKey = new Map(seed.map((e) => [e.key, e]));
  const sceneSet = new Set(scenes);
  const known = new Set<string>();
  const rules = new Set<SoundRule>();
  const seen = new Set<string>();
  const lessonIds = new Set<string>();

  for (const unit of course.units) {
    for (const slug of unit.scenes) if (scenes.length && !sceneSet.has(slug)) problems.push(`${unit.id}: unknown scene "${slug}"`);
    const last = unit.lessons.at(-1);
    if (!last || last.kind !== "checkpoint") problems.push(`${unit.id}: must end with a checkpoint`);

    for (const lesson of unit.lessons) {
      const at = `${lesson.id} (${lesson.title})`;
      if (lessonIds.has(lesson.id)) problems.push(`${at}: duplicate lesson id`);
      lessonIds.add(lesson.id);
      lesson.letters?.forEach((l) => known.add(l));
      lesson.rules?.forEach((r) => rules.add(r));

      if (lesson.kind === "checkpoint") {
        if (!lesson.scene) problems.push(`${at}: a checkpoint needs a scene`);
        else if (!unit.scenes.includes(lesson.scene)) problems.push(`${at}: its scene isn't one of the unit's`);
        continue;
      }
      if (lesson.items.length === 0) problems.push(`${at}: no items`);

      for (const item of lesson.items) {
        const entry = byKey.get(item.key);
        if (!entry) {
          problems.push(`${at}: "${item.key}" is not in the seed`);
          continue;
        }
        if (seen.has(item.key)) problems.push(`${at}: "${item.key}" is introduced twice`);
        seen.add(item.key);
        if (item.mode === "heard" && lesson.kind !== "phrases") problems.push(`${at}: "${item.key}" is heard-first outside a phrases lesson`);

        const missing = [...new Set(scriptUnits(item.key).filter((u) => !known.has(u)))];
        if (missing.length && !item.mode) problems.push(`${at}: "${item.key}" needs ${missing.join(" ")} (not taught yet)`);
        if (item.mode === "sight" || missing.length) continue;

        const predicted = predictReading(item.key, known, rules);
        if (!entry.romanization) problems.push(`${at}: "${item.key}" has no reading to check`);
        else if (predicted !== undefined && !readingMatches(predicted, entry.romanization)) {
          problems.push(`${at}: "${item.key}" sounds out as "${predicted}" but is read "${entry.romanization}"; mark it sight or teach its rule first`);
        }
      }
      for (const l of lesson.letters ?? []) {
        if (!lesson.items.some((i) => scriptUnits(i.key).includes(l))) problems.push(`${at}: teaches ${l} but no item uses it`);
      }
    }
  }
  return problems;
}
