import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, DEFAULT_MODEL } from "./client";
import { LANG_SPECS, langName, type Lang } from "@/lib/lang";

export const GENRES = ["dialogue", "short story", "news-style", "café scene", "somewhere I am"] as const;
export type Genre = (typeof GENRES)[number];

export interface GenerateInput {
  lang?: Lang;
  /** Lemmas the learner knows (learning or review). */
  known: string[];
  /** Fixed phrases the learner knows. */
  chunks: string[];
  /** Target fraction of word tokens drawn from the known list, 0.90–0.98. */
  targetCoverage: number;
  genre: Genre;
  /** Free text for "somewhere I am" or any extra steer. */
  topic?: string;
  /** Lemmas that must appear. */
  mustInclude: string[];
  /** Titles of recent passages, to avoid repeats. */
  avoidTitles?: string[];
}

export interface GeneratedPassage {
  title: string;
  text: string;
}

const Output = z.object({ title: z.string(), text: z.string() });

const system = (lang: Lang) => `You write short ${langName(lang)} reading passages for an adult learner. ${LANG_SPECS[lang].modelNote} The learner's known vocabulary is given as a list of dictionary forms (lemmas); you may use any inflection of them, plus names, numbers, and the fixed phrases listed.
Aim for the requested share of words from the known list. The remaining words should be useful, common, guessable from context, and reused at least twice so they can be learned by reading. Never use rare or literary words.
Natural, adult ${langName(lang)}; no explanations, no glossary, no English. 150–300 words. Paragraphs separated by blank lines. Dialogue lines start with ${lang === "el" ? "—" : "«"}.
Return a short ${langName(lang)} title and the text.`;

export async function generatePassage(input: GenerateInput): Promise<GeneratedPassage> {
  const lang = input.lang ?? "fr";
  const pct = Math.round(input.targetCoverage * 100);
  const user = [
    `Genre: ${input.genre}${input.topic ? ` — ${input.topic}` : ""}`,
    `Target: about ${pct}% of the words from the known list, ${100 - pct}% new.`,
    input.mustInclude.length ? `Must use (any form): ${input.mustInclude.join(", ")}` : "",
    input.avoidTitles?.length ? `Avoid repeating these earlier passages: ${input.avoidTitles.join("; ")}` : "",
    `Known fixed phrases: ${input.chunks.join(" | ") || "(none)"}`,
    `Known lemmas (${input.known.length}): ${input.known.join(" ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await anthropic().messages.parse({
    model: DEFAULT_MODEL,
    max_tokens: 4096,
    system: system(lang),
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(Output), effort: "low" },
  });
  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`No parseable passage (stop_reason=${response.stop_reason}).`);
  const text = parsed.text.trim();
  if (text.split(/\s+/).length < 60) throw new Error("The model returned too short a passage; try again.");
  return { title: parsed.title.trim() || LANG_SPECS[lang].untitled, text };
}
