/**
 * Copy glosses from the database back into db/seed/frequency-fr.json so they
 * can be committed. Only fills entries whose file gloss is empty.
 *
 *   npm run seed:export
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { atoms } from "@/db/schema";
import type { FrequencyEntry } from "@/lib/atoms/seed";

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, "..", "db", "seed", "frequency-fr.json");

async function main() {
  if (!hasDatabase()) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const entries = JSON.parse(readFileSync(FILE, "utf8")) as FrequencyEntry[];
  const rows = await db().select({ key: atoms.key, gloss: atoms.gloss }).from(atoms).where(eq(atoms.type, "word"));
  const byKey = new Map(rows.map((r) => [r.key, r.gloss]));
  let filled = 0;
  for (const e of entries) {
    const g = byKey.get(e.lemma);
    if (!e.gloss && g) {
      e.gloss = g;
      filled++;
    }
  }
  writeFileSync(FILE, JSON.stringify(entries, null, 1) + "\n");
  console.log(`filled ${filled} glosses from the database; ${entries.filter((e) => !e.gloss).length} still empty.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
