/**
 * Runs before `next build`. If DATABASE_URL is set, applies pending migrations
 * and upserts the seed atoms so a fresh deploy is usable with no terminal.
 * Both steps are idempotent. Without DATABASE_URL it does nothing, so local
 * builds and previews without a database still succeed.
 *
 *   npm run db:prepare
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import * as schema from "@/db/schema";
import { seedAtoms } from "@/db/seed/run";
import type { ChunkEntry, FrequencyEntry, GrammarEntry } from "@/lib/atoms/seed";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const load = <T>(name: string): T =>
  JSON.parse(readFileSync(path.join(root, "db", "seed", name), "utf8")) as T;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("db:prepare — DATABASE_URL not set, skipping migrations and seed.");
    return;
  }

  const db = drizzle(neon(url), { schema });

  console.log("db:prepare — applying migrations…");
  await migrate(db, { migrationsFolder: path.join(root, "drizzle") });

  console.log("db:prepare — seeding atoms…");
  const result = await seedAtoms(db, {
    freq: load<FrequencyEntry[]>("frequency-fr.json"),
    chunks: load<ChunkEntry[]>("chunks-fr.json"),
    grammar: load<GrammarEntry[]>("grammar-fr.json"),
  });
  console.log(`db:prepare — upserted ${result.upserted} atoms, linked ${result.linked} chunks.`);
  if (result.unglossed) {
    console.log(`db:prepare — ${result.unglossed} words still have no gloss (run \`npm run seed:gloss\`).`);
  }
}

main().catch((err) => {
  console.error("db:prepare failed:", err);
  process.exit(1);
});
