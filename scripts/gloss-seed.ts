/**
 * Fill empty glosses in db/seed/frequency-fr.json using the Anthropic API.
 * Resumable: results are written back after every batch. Needs ANTHROPIC_API_KEY.
 * (The home page can do the same against the database; `npm run seed:export`
 * then copies those glosses back into this file.)
 *
 *   npm run seed:gloss
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { FrequencyEntry } from "@/lib/atoms/seed";
import { glossLemmas } from "@/lib/llm/gloss";

const BATCH = 100;
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, "..", "db", "seed", "frequency-fr.json");

async function main() {
  const entries = JSON.parse(readFileSync(FILE, "utf8")) as FrequencyEntry[];
  const byLemma = new Map(entries.map((e) => [e.lemma, e]));
  const todo = entries.filter((e) => !e.gloss);
  if (todo.length === 0) {
    console.log("All entries already have glosses.");
    return;
  }
  console.log(`${todo.length} entries to gloss, ${BATCH} per request.`);
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const glosses = await glossLemmas(batch);
    let filled = 0;
    for (const [lemma, gloss] of glosses) {
      const entry = byLemma.get(lemma);
      if (entry && !entry.gloss) {
        entry.gloss = gloss;
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
