import { anthropic, DEFAULT_MODEL } from "./client";
import { LANG_SPECS, langName, type Lang } from "@/lib/lang";

const system = (lang: Lang) => `You are a patient ${langName(lang)} tutor for an adult English speaker. ${LANG_SPECS[lang].modelNote} Answer questions about ${langName(lang)} (words, grammar, usage, culture, how to say something) in plain English with ${langName(lang)} examples.${lang === "el" ? " Give the pronunciation of any Greek you quote in Latin letters in brackets." : ""}
Keep it short: a few sentences, or a short list when comparing forms. No drills. If the question is not about ${langName(lang)} or language learning, say so briefly and steer back.`;

/** "Explore": ask anything about the language. Same model, no memory effect. */
export async function explore(question: string, lang: Lang = "fr"): Promise<string> {
  const response = await anthropic().messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1500,
    system: system(lang),
    messages: [{ role: "user", content: question }],
    output_config: { effort: "low" },
  });
  if (response.stop_reason === "refusal") return "I can't help with that one.";
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
