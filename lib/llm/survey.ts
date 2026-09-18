import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, DEFAULT_MODEL } from "./client";

export interface SurveyInput {
  title: string;
  /** The opening of the goal text; enough to see how it is written. */
  text: string;
  /** Grammar atoms that already exist, as "key: gloss", with the ones the learner knows marked. */
  grammar: Array<{ key: string; gloss: string; known: boolean }>;
}

export interface SurveyedGrammar {
  /** An existing key, or a new short slug like "passe-simple". */
  key: string;
  gloss: string;
  explanation: string;
  /** Met only in writing: the learner needs to read it, never to say it. */
  receptiveOnly: boolean;
}

export interface Survey {
  grammar: SurveyedGrammar[];
  scenes: string[];
}

const Output = z.object({
  grammar: z.array(z.object({ key: z.string(), gloss: z.string(), explanation: z.string(), receptiveOnly: z.boolean() })),
  scenes: z.array(z.string()),
});

const SYSTEM = `An adult learner of French wants to read a particular text one day. Survey it.
"grammar": the 2–5 grammar ideas this text leans on most that the learner doesn't know yet, most important first. Reuse a key from the given list when one fits; otherwise invent a short lowercase slug (e.g. "passe-simple", "relative-clauses-dont"). "gloss" is a short English name for the idea. "explanation" is 3–5 sentences for an adult, quoting one short example from this text. Set receptiveOnly=true for forms met only in writing (passé simple, literary subjunctive), which the learner must recognise but will never say.
"scenes": one or two everyday spoken situations, each one English sentence addressed to "you", in which the people and subject of this text would naturally come up (e.g. "Your father-in-law is showing you old family photographs and telling you who everyone is."). They will be turned into practice dialogues.`;

export async function surveyText(input: SurveyInput): Promise<Survey> {
  const user = [
    `Title: ${input.title}`,
    `Grammar ideas already in the app (✓ = the learner knows it):\n${input.grammar.map((g) => `${g.known ? "✓" : "·"} ${g.key}: ${g.gloss}`).join("\n")}`,
    `The text:\n${input.text}`,
  ].join("\n\n");
  const response = await anthropic().messages.parse({
    model: DEFAULT_MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(Output), effort: "low" },
  });
  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`No parseable survey (stop_reason=${response.stop_reason}).`);
  return { grammar: parsed.grammar.slice(0, 5), scenes: parsed.scenes.map((s) => s.trim()).filter(Boolean).slice(0, 2) };
}
