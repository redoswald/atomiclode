import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, DEFAULT_MODEL } from "./client";

export interface WhyAtom {
  key: string;
  type: "word" | "chunk" | "grammar";
  forms: string[];
  gloss: string;
  pos?: string;
}

export interface GrammarConcept {
  key: string;
  gloss: string;
}

export interface WhyInput {
  atom: WhyAtom;
  sentence?: string;
  /** Grammar atoms the learner already has, so the model links rather than duplicates. */
  concepts: GrammarConcept[];
}

export interface WhyResult {
  explanation: string;
  grammar?: {
    key: string;
    title: string;
    explanation: string;
    /** True when `key` matched one of the learner's existing grammar atoms. */
    existing: boolean;
  };
}

const Output = z.object({
  explanation: z.string(),
  grammarAtomKey: z.string().nullable(),
  grammarTitle: z.string().nullable(),
  grammarExplanation: z.string().nullable(),
});

const SYSTEM = `You explain French to an adult English speaker who is learning by reading.
Write 3–6 plain sentences. If a sentence is given, use it as the example and quote the relevant words from it.
Name the grammar concept at work, if there is one, in ordinary terms. No drills, no exercises, no bullet points, no headings.

You are also given the learner's existing grammar concepts as key: title pairs.
- If the explanation hinges on one of them, set grammarAtomKey to that key exactly, and grammarTitle/grammarExplanation to null.
- If it hinges on a concept not in the list, propose a new key as a short kebab-case slug (e.g. "subjunctive-after-il-faut"), a title of at most 6 words, and a 2–3 sentence grammarExplanation that would stand on its own as a flashcard.
- If no grammar concept is worth a card (plain vocabulary), set all three to null.`;

export async function explain(input: WhyInput): Promise<WhyResult> {
  const concepts = input.concepts.map((c) => `${c.key}: ${c.gloss}`).join("\n") || "(none yet)";
  const atomLine =
    input.atom.type === "grammar"
      ? `Grammar concept: ${input.atom.key} — ${input.atom.gloss}`
      : `${input.atom.type === "chunk" ? "Phrase" : "Word"}: ${input.atom.key}${input.atom.pos ? ` (${input.atom.pos.toLowerCase()})` : ""}` +
        (input.atom.gloss ? ` — ${input.atom.gloss}` : "") +
        (input.atom.forms.length > 1 ? `\nForms seen: ${input.atom.forms.slice(0, 8).join(", ")}` : "");
  const user = [atomLine, input.sentence ? `Sentence: ${input.sentence}` : "No sentence; explain the word in general.", `Learner's grammar concepts:\n${concepts}`].join("\n\n");

  const response = await anthropic().messages.parse({
    model: DEFAULT_MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(Output), effort: "low" },
  });
  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`No parseable explanation (stop_reason=${response.stop_reason}).`);

  const result: WhyResult = { explanation: parsed.explanation.trim() };
  const key = parsed.grammarAtomKey?.trim();
  if (key) {
    const existing = input.concepts.find((c) => c.key === key);
    if (existing) {
      result.grammar = { key, title: existing.gloss, explanation: "", existing: true };
    } else if (parsed.grammarTitle && parsed.grammarExplanation) {
      result.grammar = {
        key: slug(key),
        title: parsed.grammarTitle.trim(),
        explanation: parsed.grammarExplanation.trim(),
        existing: false,
      };
    }
  }
  return result;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
