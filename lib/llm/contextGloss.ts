import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, DEFAULT_MODEL } from "./client";

const Output = z.object({
  gloss: z.string(),
  lemmaGloss: z.string(),
});

const SYSTEM = `You help an adult English speaker read French. Given a French word as it appears in a sentence, return:
- gloss: the English meaning of the word in this exact sentence, 1–5 words, no article for nouns, "to ..." for verbs.
- lemmaGloss: the most common everyday meaning of its dictionary form, same style.
No explanations, no examples.`;

export interface ContextGloss {
  gloss: string;
  lemmaGloss: string;
}

export async function glossInContext(lemma: string, surface: string, sentence: string): Promise<ContextGloss> {
  const response = await anthropic().messages.parse({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: `Word: ${surface}\nDictionary form: ${lemma}\nSentence: ${sentence}` }],
    output_config: { format: zodOutputFormat(Output), effort: "low" },
  });
  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`No parseable gloss (stop_reason=${response.stop_reason}).`);
  return { gloss: parsed.gloss.trim(), lemmaGloss: parsed.lemmaGloss.trim() };
}
