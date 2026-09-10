/**
 * Fill empty glosses in db/seed/frequency-fr.json using the Anthropic API.
 * Resumable: results are written back after every batch, and only entries with
 * an empty gloss are sent. Needs ANTHROPIC_API_KEY in .env.local (or the env).
 *
 *   npm run seed:gloss
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { FrequencyEntry } from "@/lib/atoms/seed";

const MODEL = "claude-opus-5";
const BATCH = 100;

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, "..", "db", "seed", "frequency-fr.json");

const Output = z.object({
  glosses: z.array(
    z.object({
      lemma: z.string(),
      gloss: z.string(),
    }),
  ),
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

async function main() {
  const entries = JSON.parse(readFileSync(FILE, "utf8")) as FrequencyEntry[];
  const byLemma = new Map(entries.map((e) => [e.lemma, e]));
  const todo = entries.filter((e) => !e.gloss);
  if (todo.length === 0) {
    console.log("All entries already have glosses.");
    return;
  }
  console.log(`${todo.length} entries to gloss with ${MODEL}, ${BATCH} per request.`);

  const client = new Anthropic();
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const list = batch
      .map((e) => `${e.lemma}\t${e.pos}${e.gender ? ` (${e.gender})` : ""}`)
      .join("\n");

    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: `Gloss these lemmas (lemma<TAB>POS):\n${list}` }],
      output_config: { format: zodOutputFormat(Output) },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error(`Batch ${i / BATCH + 1}: model returned no parseable output (stop_reason=${response.stop_reason}).`);
    }
    let filled = 0;
    for (const { lemma, gloss } of parsed.glosses) {
      const entry = byLemma.get(lemma);
      if (entry && !entry.gloss && gloss.trim()) {
        entry.gloss = gloss.trim();
        filled++;
      }
    }
    writeFileSync(FILE, JSON.stringify(entries, null, 1) + "\n");
    console.log(`batch ${i / BATCH + 1}/${Math.ceil(todo.length / BATCH)}: filled ${filled}/${batch.length}`);
  }

  const remaining = entries.filter((e) => !e.gloss).length;
  console.log(remaining ? `${remaining} entries still unglossed; re-run to retry.` : "Done: every entry has a gloss.");
}

main().catch((err) => {
  if (err instanceof Anthropic.AuthenticationError) {
    console.error("Anthropic API key missing or invalid. Set ANTHROPIC_API_KEY in .env.local.");
  } else if (err instanceof Anthropic.RateLimitError) {
    console.error("Rate limited. Wait a minute and re-run; progress is saved.");
  } else if (err instanceof Anthropic.APIError) {
    console.error(`Anthropic API error ${err.status}: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
