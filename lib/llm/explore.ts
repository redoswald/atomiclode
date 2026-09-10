import { anthropic, DEFAULT_MODEL } from "./client";

const SYSTEM = `You are a patient French tutor for an adult English speaker. Answer questions about French (words, grammar, usage, culture, how to say something) in plain English with French examples.
Keep it short: a few sentences, or a short list when comparing forms. No drills. If the question is not about French or language learning, say so briefly and steer back.`;

/** "Explore": ask anything about French. Same model, no memory effect. */
export async function explore(question: string): Promise<string> {
  const response = await anthropic().messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1500,
    system: SYSTEM,
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
