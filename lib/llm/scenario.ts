import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, DEFAULT_MODEL } from "./client";

export interface GenerateVisitInput {
  scenario: { title: string; brief: string };
  /** 1 for a brand-new custom scenario. */
  n: number;
  /** One line per earlier visit, oldest first. */
  earlier: string[];
  /** Lemmas and fixed phrases the learner knows or is already learning. */
  known: string[];
  chunks: string[];
  /** Unknown lemmas worth teaching next, best first: frequency list, then the goal text. */
  candidates: string[];
  /** Grammar atoms the learner hasn't met, as "key: gloss". */
  grammar: string[];
}

export interface GeneratedVisit {
  title: string;
  brief: string;
  summary: string;
  dialogue: string;
  translation: string;
  bundle: Array<{ type: "word" | "chunk"; key: string; gloss: string }>;
  grammarKey: string;
  prompts: Array<{ situation: string; exampleAnswer: string; targets: string[] }>;
}

const Output = z.object({
  title: z.string(),
  brief: z.string(),
  summary: z.string(),
  dialogue: z.string(),
  translation: z.string(),
  bundle: z.array(z.object({ type: z.enum(["word", "chunk"]), key: z.string(), gloss: z.string() })),
  grammarKey: z.string(),
  prompts: z.array(z.object({ situation: z.string(), exampleAnswer: z.string(), targets: z.array(z.string()) })),
});

const SYSTEM = `You write one "visit" to a recurring real-life situation for an adult learning French. Each visit to the same place goes a little further than the last: a complication, a follow-up question, a bit of small talk. The learner is "you" in the scene.

Return:
- title: a short French title for the situation (keep the given one unless it is empty).
- brief: one or two English sentences addressed to "you": what is different this time and what you need to get done. No French.
- dialogue: 60–120 words of natural, adult, spoken French between you and the other person. Each line starts with "— ". A line of narration between blank lines is fine. Write it from the known vocabulary plus the bundle, and as little else as you can; names and numbers are free.
- translation: the dialogue in English, line for line.
- bundle: the 6–10 new things this visit teaches, in the order they should be learned: fixed phrases (type "chunk") first, then words (type "word"). Chunks are written exactly as they appear in the dialogue, lowercase. Words are dictionary forms (infinitive, masculine singular) and should come from the candidate list wherever they honestly fit the situation; never force one in. Every bundle item must actually be used in the dialogue. Nothing the learner already knows. Short English gloss for each.
- grammarKey: the key of at most one listed grammar idea that this dialogue genuinely leans on, or "".
- prompts: 1–3 speaking prompts. "situation" is English, addressed to "you", concrete, and never names or translates the French it is fishing for. "exampleAnswer" is one short natural thing to say. "targets" lists the bundle keys the answer uses, copied exactly.
- summary: one English line on what happened, for writing the next visit.`;

export async function generateVisit(input: GenerateVisitInput): Promise<GeneratedVisit> {
  const user = [
    `Situation: ${input.scenario.title || "(untitled)"} — ${input.scenario.brief}`,
    `This is visit ${input.n}.`,
    input.earlier.length ? `Earlier visits:\n${input.earlier.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "",
    `Candidates to teach (best first): ${input.candidates.join(" ") || "(none; choose common words that fit)"}`,
    input.grammar.length ? `Grammar ideas not met yet:\n${input.grammar.join("\n")}` : "",
    `Known fixed phrases: ${input.chunks.join(" | ") || "(none)"}`,
    `Known lemmas (${input.known.length}): ${input.known.join(" ") || "(none yet: keep it very simple)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await anthropic().messages.parse({
    model: DEFAULT_MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(Output), effort: "low" },
  });
  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`No parseable visit (stop_reason=${response.stop_reason}).`);
  return parsed;
}
