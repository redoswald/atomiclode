import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, DEFAULT_MODEL } from "./client";
import { LANG_SPECS, langName, type Lang } from "@/lib/lang";

/** A target the situation is fishing for: a word, phrase, or grammar idea. */
export interface ProduceTarget {
  key: string;
  gloss: string;
}

export interface GradeProduceInput {
  lang?: Lang;
  situation: string;
  targets: ProduceTarget[];
  exampleAnswer: string;
  answer: string;
}

export interface ProduceVerdict {
  /** Would a native speaker understand this and find it acceptable in the situation? */
  ok: boolean;
  /** Keys of the targets the learner used acceptably (any inflection). */
  used: string[];
  /** The learner's answer, minimally corrected into the natural form. */
  natural: string;
  /** One line: the most useful thing to fix or notice. Empty when there is nothing to say. */
  note: string;
}

const Verdict = z.object({ ok: z.boolean(), used: z.array(z.string()), natural: z.string(), note: z.string() });

const gradeSystem = (lang: Lang) => `You check what an adult learner of ${langName(lang)} typed in answer to a real-life situation. ${LANG_SPECS[lang].modelNote} Be lenient the way a waiter is: hesitation, fillers, missing accents, small agreement slips and a second attempt inside the same answer are all fine if a ${langName(lang)} speaker would understand and not wince.${lang === "el" ? " The learner may type Greek in Latin letters (Greeklish, e.g. \"efharisto poli\"); read it as the Greek it stands for and write \"natural\" in the Greek alphabet." : ""} Mark ok=false only when the meaning fails, the register is badly wrong for the situation, or the answer isn't ${langName(lang)}.
"used" lists which of the given target keys the learner used acceptably, in any inflection; copy the keys exactly as given.
"natural" is their answer minimally corrected, keeping their wording where it works. If it was already fine, return it unchanged.
"note" is one short sentence in English on the single most useful thing to fix or notice; empty string if nothing.`;

export async function gradeProduce(input: GradeProduceInput): Promise<ProduceVerdict> {
  const user = [
    `Situation: ${input.situation}`,
    `Targets: ${input.targets.map((t) => `${t.key} (${t.gloss})`).join("; ")}`,
    `One natural answer, for reference: ${input.exampleAnswer}`,
    `The learner typed: ${input.answer}`,
  ].join("\n");
  const response = await anthropic().messages.parse({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: gradeSystem(input.lang ?? "fr"),
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(Verdict), effort: "low" },
  });
  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`No parseable verdict (stop_reason=${response.stop_reason}).`);
  const keys = new Set(input.targets.map((t) => t.key));
  return { ok: parsed.ok, used: parsed.used.filter((k) => keys.has(k)), natural: parsed.natural.trim(), note: parsed.note.trim() };
}

export interface WritePromptInput {
  lang?: Lang;
  target: ProduceTarget & { type: "word" | "chunk" | "grammar" };
  domains: string[];
  /** A sentence the learner met the atom in, if any, to keep the situation close to home. */
  sentence?: string;
}

const Prompt = z.object({ situation: z.string(), exampleAnswer: z.string() });

const writeSystem = (lang: Lang) => `You write one speaking prompt for an adult learner of ${langName(lang)}. ${LANG_SPECS[lang].modelNote} Never "use X in a sentence". Describe, in one or two English sentences addressed to "you", a concrete everyday situation in which a ${langName(lang)} speaker would naturally say the target: where you are, who you're talking to, what you want. Do not mention the target word or translate it in the situation.
"exampleAnswer" is one short, natural thing to say in ${langName(lang)} in that situation that uses the target.`;

/** For atoms that never came from a scenario: a situation made to order, cached by the caller. */
export async function writeProducePrompt(input: WritePromptInput): Promise<{ situation: string; exampleAnswer: string }> {
  const user = [
    `Target (${input.target.type}): ${input.target.key} — ${input.target.gloss}`,
    input.domains.length ? `Topics: ${input.domains.join(", ")}` : "",
    input.sentence ? `The learner met it in: ${input.sentence}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const response = await anthropic().messages.parse({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: writeSystem(input.lang ?? "fr"),
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(Prompt), effort: "low" },
  });
  const parsed = response.parsed_output;
  if (!parsed?.situation.trim() || !parsed.exampleAnswer.trim()) throw new Error("No usable produce prompt.");
  return { situation: parsed.situation.trim(), exampleAnswer: parsed.exampleAnswer.trim() };
}
