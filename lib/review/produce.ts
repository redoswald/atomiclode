/**
 * Situational produce cards (SPEC §6): find or write the prompt for an atom,
 * check a free-text answer with the model, and log the result.
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, producePrompts, sentences, type ProducePromptRow } from "@/db/schema";
import type { Atom, Grade } from "@/lib/atoms/types";
import { gradeProduce, writeProducePrompt, type GradeProduceInput, type ProduceVerdict, type WritePromptInput } from "@/lib/llm/produce";
import { isKnownStatus } from "@/lib/reader/coverage";
import { recordReview, type RecordReviewResult } from "./record";

export type WritePromptFn = (input: WritePromptInput) => Promise<{ situation: string; exampleAnswer: string }>;
export type GradeFn = (input: GradeProduceInput) => Promise<ProduceVerdict>;

/** Prompts are written on demand for at most this many atoms per session; the rest fall back to recall. */
export const PROMPTS_WRITTEN_PER_SESSION = 3;

/** One stored prompt per atom, rotating through the available ones as reps go up. */
export async function promptsFor(d: Db, wanted: Atom[]): Promise<Map<string, ProducePromptRow>> {
  const out = new Map<string, ProducePromptRow>();
  if (wanted.length === 0) return out;
  const ids = sql.join(wanted.map((a) => sql`${a.id}::uuid`), sql`, `);
  const rows = await d
    .select()
    .from(producePrompts)
    .where(sql`${producePrompts.targetAtomIds} && ARRAY[${ids}]`)
    .orderBy(producePrompts.createdAt);
  for (const a of wanted) {
    const mine = rows.filter((r) => r.targetAtomIds.includes(a.id));
    if (mine.length) out.set(a.id, mine[a.memory.reps % mine.length]);
  }
  return out;
}

/** Write and store prompts for atoms that have none. Failures are swallowed: the card degrades instead. */
export async function writePrompts(d: Db, wanted: Atom[], write: WritePromptFn = writeProducePrompt): Promise<Map<string, ProducePromptRow>> {
  const out = new Map<string, ProducePromptRow>();
  const batch = wanted.slice(0, PROMPTS_WRITTEN_PER_SESSION);
  await Promise.all(
    batch.map(async (a) => {
      try {
        const [met] = await d
          .select({ text: sentences.text })
          .from(sentences)
          .where(sql`${a.id}::uuid = any(${sentences.atomIds})`)
          .limit(1);
        const written = await write({ target: { key: a.key, gloss: a.gloss, type: a.type }, domains: a.domains, sentence: met?.text });
        const [row] = await d
          .insert(producePrompts)
          .values({ situation: written.situation, exampleAnswer: written.exampleAnswer, targetAtomIds: [a.id] })
          .returning();
        out.set(a.id, row);
      } catch {
        // No prompt, no produce card.
      }
    }),
  );
  return out;
}

export interface ProduceCheck extends ProduceVerdict {
  /** Target atoms the learner used acceptably. */
  usedAtomIds: string[];
}

export async function checkProduce(d: Db, promptId: string, answer: string, grade: GradeFn = gradeProduce): Promise<ProduceCheck> {
  const [prompt] = await d.select().from(producePrompts).where(eq(producePrompts.id, promptId));
  if (!prompt) throw new Error("unknown prompt");
  const text = answer.trim().slice(0, 600);
  if (!text) throw new Error("Type something first.");
  const targets = prompt.targetAtomIds.length
    ? await d.select({ id: atoms.id, key: atoms.key, gloss: atoms.gloss }).from(atoms).where(inArray(atoms.id, prompt.targetAtomIds))
    : [];
  const verdict = await grade({ situation: prompt.situation, targets, exampleAnswer: prompt.exampleAnswer, answer: text });
  const idByKey = new Map(targets.map((t) => [t.key, t.id]));
  return { ...verdict, usedAtomIds: verdict.used.map((k) => idByKey.get(k)).filter((x): x is string => Boolean(x)) };
}

export interface RecordProduceInput {
  atomId: string;
  promptId: string;
  grade: Grade;
  responseMs: number;
  usedAtomIds: string[];
}

/**
 * The scheduled atom gets the grade the learner confirmed. Other targets of the
 * same prompt that were used well, and that the learner already knows, get a
 * Good: it is real evidence. A target that went unused gets nothing: leaving a
 * word out of a free answer says little about having forgotten it.
 */
export async function recordProduce(d: Db, input: RecordProduceInput, now = new Date()): Promise<RecordReviewResult> {
  const [prompt] = await d.select().from(producePrompts).where(eq(producePrompts.id, input.promptId));
  if (!prompt || !prompt.targetAtomIds.includes(input.atomId)) throw new Error("prompt does not target this atom");
  const result = await recordReview(d, { atomId: input.atomId, modality: "produce", grade: input.grade, responseMs: input.responseMs }, now);

  const others = input.usedAtomIds.filter((id) => id !== input.atomId && prompt.targetAtomIds.includes(id));
  if (others.length) {
    const rows = await d.select({ id: atoms.id, status: atoms.status }).from(atoms).where(inArray(atoms.id, others));
    for (const r of rows) {
      if (!isKnownStatus(r.status)) continue;
      await recordReview(d, { atomId: r.id, modality: "produce", grade: 3, responseMs: input.responseMs }, now);
    }
  }
  return result;
}
