import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, DEFAULT_MODEL } from "./client";
import { LANG_SPECS, langName, type Lang } from "@/lib/lang";

const Output = z.object({
  gloss: z.string(),
  lemmaGloss: z.string(),
  sentenceTranslation: z.string(),
  romanization: z.string(),
});

const system = (lang: Lang) => `You help an adult English speaker read ${langName(lang)}. ${LANG_SPECS[lang].modelNote} Given a ${langName(lang)} word as it appears in a sentence, return:
- gloss: the English meaning of the word in this exact sentence, 1–5 words, no article for nouns, "to ..." for verbs.
- lemmaGloss: the most common everyday meaning of its dictionary form, same style.
- sentenceTranslation: a natural English translation of the whole sentence.
- romanization: ${lang === "el" ? "the word as it appears, in Latin letters the way a phrasebook writes it (e.g. efcharistó), stress marked with an acute accent." : "an empty string."}
No explanations, no examples.`;

export interface ContextGloss {
  gloss: string;
  lemmaGloss: string;
  sentenceTranslation: string;
  romanization?: string;
}

export async function glossInContext(lemma: string, surface: string, sentence: string, lang: Lang = "fr"): Promise<ContextGloss> {
  const response = await anthropic().messages.parse({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: system(lang),
    messages: [{ role: "user", content: `Word: ${surface}\nDictionary form: ${lemma}\nSentence: ${sentence}` }],
    output_config: { format: zodOutputFormat(Output), effort: "low" },
  });
  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`No parseable gloss (stop_reason=${response.stop_reason}).`);
  return {
    gloss: parsed.gloss.trim(),
    lemmaGloss: parsed.lemmaGloss.trim(),
    sentenceTranslation: parsed.sentenceTranslation.trim(),
    romanization: lang === "el" && parsed.romanization.trim() ? parsed.romanization.trim() : undefined,
  };
}
