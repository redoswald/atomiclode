import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, DEFAULT_MODEL } from "./client";

/** "Adapt this text": same meaning, a clearer path. */
export const LEVELS = {
  comfortable: { targetCoverage: 0.98, label: "Comfortable", blurb: "Simpler words and shorter sentences." },
  balanced: { targetCoverage: 0.95, label: "Balanced", blurb: "Keeps the meaning, simplifies the wording." },
  challenging: { targetCoverage: 0.9, label: "Challenging", blurb: "Closer to the original with richer vocabulary." },
} as const;
export type Level = keyof typeof LEVELS;

export interface AdaptInput {
  text: string;
  title?: string;
  known: string[];
  chunks: string[];
  level: Level;
}

const Output = z.object({ title: z.string(), text: z.string() });

const SYSTEM = `You rewrite a French text for an adult learner so that they can read it with the vocabulary they have, keeping the meaning, the facts, and the order of ideas.
The learner's known vocabulary is a list of dictionary forms (lemmas); you may use any inflection of them, plus names, numbers, and the fixed phrases listed.
Aim for the requested share of words from the known list. Words outside it should be the ones that matter most to the meaning, used more than once where natural.
Natural adult French; no explanations, no glossary, no English. Keep the length within about 60–120% of the original, at most 300 words. Paragraphs separated by blank lines.
Return a short French title (keep the original title if given) and the text.`;

export async function adaptText(input: AdaptInput): Promise<{ title: string; text: string }> {
  const { targetCoverage } = LEVELS[input.level];
  const pct = Math.round(targetCoverage * 100);
  const user = [
    `Target: about ${pct}% of the words from the known list.`,
    input.title ? `Original title: ${input.title}` : "",
    `Known fixed phrases: ${input.chunks.join(" | ") || "(none)"}`,
    `Known lemmas (${input.known.length}): ${input.known.join(" ")}`,
    `Original text:\n${input.text}`,
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
  if (!parsed) throw new Error(`No parseable adaptation (stop_reason=${response.stop_reason}).`);
  const text = parsed.text.trim();
  if (text.split(/\s+/).length < 30) throw new Error("The model returned too short a text; try again.");
  return { title: parsed.title.trim() || input.title || "Sans titre", text };
}
