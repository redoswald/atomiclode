/**
 * Seed scenarios (SPEC §10): the shape of db/seed/scenarios-fr.json and the
 * checks it must pass. Pure: no I/O, no DB. Generated visits go through the
 * same bundle check, so a word the model promised but didn't use is dropped.
 */
import { chunkPattern } from "@/lib/reader/chunks";
import { normalizeForm } from "@/lib/reader/lexicon";
import { analyzeLocal, type Token } from "@/lib/reader/tokenize";

export interface BundleEntry {
  type: "word" | "chunk" | "grammar";
  /** word: lemma; chunk: the phrase as it appears; grammar: an existing grammar atom key. */
  key: string;
  gloss: string;
}

export interface PromptEntry {
  situation: string;
  exampleAnswer: string;
  /** Keys of word or chunk atoms. */
  targets: string[];
}

export interface VisitEntry {
  brief: string;
  summary: string;
  dialogue: string;
  translation: string;
  bundle: BundleEntry[];
  prompts: PromptEntry[];
}

export interface ScenarioEntry {
  slug: string;
  title: string;
  brief: string;
  domains: string[];
  visit: VisitEntry;
}

/** Does the text use this word (any inflection) or this phrase (as written)? */
export function appearsIn(entry: BundleEntry, tokens: Token[]): boolean {
  const words = tokens.filter((t) => t.isWord);
  if (entry.type === "grammar") return true;
  if (entry.type === "word") {
    const key = normalizeForm(entry.key);
    return words.some((t) => t.lemma === key || normalizeForm(t.surface) === key);
  }
  const pattern = chunkPattern(entry.key);
  const norm = words.map((t) => normalizeForm(t.surface));
  for (let i = 0; i + pattern.length <= norm.length; i++) {
    if (pattern.every((w, k) => norm[i + k] === w && words[i + k].sentenceIdx === words[i].sentenceIdx)) return true;
  }
  return false;
}

export function validateScenarios(entries: ScenarioEntry[], grammarKeys: Set<string>): string[] {
  const problems: string[] = [];
  const slugs = new Set<string>();
  const allKeys = new Set(entries.flatMap((e) => e.visit.bundle.map((b) => b.key)));
  for (const e of entries) {
    if (slugs.has(e.slug)) problems.push(`duplicate slug: ${e.slug}`);
    slugs.add(e.slug);
    const { tokens } = analyzeLocal(e.visit.dialogue);
    const wordCount = tokens.filter((t) => t.isWord).length;
    if (wordCount < 40 || wordCount > 140) problems.push(`${e.slug}: dialogue is ${wordCount} words`);
    if (e.visit.dialogue.split("\n").length !== e.visit.translation.split("\n").length) problems.push(`${e.slug}: translation lines don't match the dialogue`);
    if (e.visit.bundle.length < 6 || e.visit.bundle.length > 10) problems.push(`${e.slug}: bundle has ${e.visit.bundle.length} atoms`);
    if (e.visit.bundle.filter((b) => b.type === "grammar").length > 1) problems.push(`${e.slug}: more than one grammar atom`);
    for (const b of e.visit.bundle) {
      if (!b.gloss.trim()) problems.push(`${e.slug}: "${b.key}" has no gloss`);
      if (b.type === "grammar" && !grammarKeys.has(b.key)) problems.push(`${e.slug}: unknown grammar atom "${b.key}"`);
      if (!appearsIn(b, tokens)) problems.push(`${e.slug}: "${b.key}" is not in the dialogue`);
    }
    if (e.visit.prompts.length < 1 || e.visit.prompts.length > 3) problems.push(`${e.slug}: ${e.visit.prompts.length} prompts`);
    for (const p of e.visit.prompts) {
      if (p.targets.length === 0) problems.push(`${e.slug}: a prompt has no targets`);
      const answer = analyzeLocal(p.exampleAnswer).tokens;
      for (const t of p.targets) {
        if (!allKeys.has(t)) problems.push(`${e.slug}: prompt target "${t}" is in no bundle`);
        const entry = entries.flatMap((x) => x.visit.bundle).find((b) => b.key === t);
        if (entry && !appearsIn(entry, answer)) problems.push(`${e.slug}: example answer doesn't use "${t}"`);
      }
    }
  }
  return problems;
}
