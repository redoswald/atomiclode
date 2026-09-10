import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, DEFAULT_MODEL } from "./client";

export interface GlossRequest {
  lemma: string;
  pos?: string | null;
  gender?: "m" | "f" | null;
}

const Output = z.object({
  glosses: z.array(z.object({ lemma: z.string(), gloss: z.string() })),
});

const SYSTEM = `You write dictionary glosses for a French→English vocabulary app for adult learners.
For each French lemma you are given its part of speech and, for nouns, its gender.
Return one short English gloss per lemma: the most common everyday meaning, 1–5 words.
Rules:
- Verbs: "to ..." (e.g. "to want").
- Nouns: bare noun, no article (e.g. "market"). Do not add gender; the app knows it.
- Function words: give the closest English equivalent, with a bracketed note only if needed (e.g. "of / from").
- If a word is a common interjection or filler, gloss it as such (e.g. "well / um").
- Never leave a gloss empty. Return every lemma you were given, in the same order.`;

/** One model request; returns lemma → gloss for the lemmas the model answered. */
export async function glossLemmas(items: GlossRequest[]): Promise<Map<string, string>> {
  const list = items.map((e) => `${e.lemma}\t${e.pos ?? "?"}${e.gender ? ` (${e.gender})` : ""}`).join("\n");
  const response = await anthropic().messages.parse({
    model: DEFAULT_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Gloss these lemmas (lemma<TAB>POS):\n${list}` }],
    output_config: { format: zodOutputFormat(Output), effort: "low" },
  });
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error(`Gloss request returned no parseable output (stop_reason=${response.stop_reason}).`);
  }
  const out = new Map<string, string>();
  for (const { lemma, gloss } of parsed.glosses) {
    if (gloss.trim()) out.set(lemma, gloss.trim());
  }
  return out;
}
