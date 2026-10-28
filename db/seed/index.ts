/**
 * Seed the database with the starter atoms.
 *
 *   npm run db:seed
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, hasDatabase } from "@/db";
import type { ChunkEntry, GrammarEntry, WordEntry } from "@/lib/atoms/seed";
import type { ScenarioEntry } from "@/lib/scenarios/seed";
import { seedAtoms } from "./run";
import { seedScenarios } from "./scenarios";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = <T>(name: string): T => JSON.parse(readFileSync(path.join(here, name), "utf8")) as T;

async function main() {
  if (!hasDatabase()) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }
  const files = {
    freq: load<WordEntry[]>("frequency-fr.json"),
    chunks: load<ChunkEntry[]>("chunks-fr.json"),
    grammar: load<GrammarEntry[]>("grammar-fr.json"),
  };
  const result = await seedAtoms(db(), files, "fr");
  console.log(
    `fr: upserted ${result.upserted} atoms (${files.freq.length} words, ${files.chunks.length} chunks, ${files.grammar.length} grammar); linked ${result.linked} chunks`,
  );
  const seeded = await seedScenarios(db(), load<ScenarioEntry[]>("scenarios-fr.json"), "fr");
  console.log(`fr: ${seeded.scenarios} scenarios, ${seeded.visitsWritten} first visits written`);
  if (result.unglossed) {
    console.warn(`${result.unglossed} French words have no gloss yet; run \`npm run seed:gloss\` and re-seed.`);
  }

  const el = {
    freq: load<WordEntry[]>("words-el.json"),
    chunks: load<ChunkEntry[]>("chunks-el.json"),
    grammar: load<GrammarEntry[]>("grammar-el.json"),
  };
  const elResult = await seedAtoms(db(), el, "el");
  console.log(`el: upserted ${elResult.upserted} atoms (${el.freq.length} words, ${el.chunks.length} chunks, ${el.grammar.length} grammar)`);
  const elSeeded = await seedScenarios(db(), load<ScenarioEntry[]>("scenarios-el.json"), "el");
  console.log(`el: ${elSeeded.scenarios} scenarios, ${elSeeded.visitsWritten} first visits written`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
