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
import type { ChunkEntry, FrequencyEntry, GrammarEntry } from "@/lib/atoms/seed";
import { seedAtoms } from "./run";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = <T>(name: string): T => JSON.parse(readFileSync(path.join(here, name), "utf8")) as T;

async function main() {
  if (!hasDatabase()) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }
  const files = {
    freq: load<FrequencyEntry[]>("frequency-fr.json"),
    chunks: load<ChunkEntry[]>("chunks-fr.json"),
    grammar: load<GrammarEntry[]>("grammar-fr.json"),
  };
  const result = await seedAtoms(db(), files);
  console.log(
    `upserted ${result.upserted} atoms (${files.freq.length} words, ${files.chunks.length} chunks, ${files.grammar.length} grammar); linked ${result.linked} chunks`,
  );
  if (result.unglossed) {
    console.warn(`${result.unglossed} words have no gloss yet; run \`npm run seed:gloss\` and re-seed.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
