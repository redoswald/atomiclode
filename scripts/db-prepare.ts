/**
 * Runs before `next build`. If DATABASE_URL is set, applies pending migrations
 * and refreshes every learner's starter content. Learners get theirs the first
 * time they open a language, so a fresh deploy is usable with no terminal.
 * Both steps are idempotent. Without DATABASE_URL it does nothing, so local
 * builds and previews without a database still succeed.
 *
 *   npm run db:prepare
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate as migrateNeon } from "drizzle-orm/neon-http/migrator";
import { db, isPglite } from "@/db";
import * as schema from "@/db/schema";
import { refreshLearners } from "@/lib/learners/provision";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("db:prepare — DATABASE_URL not set, skipping migrations and seed.");
    return;
  }

  const migrationsFolder = path.join(root, "drizzle");
  console.log("db:prepare — applying migrations…");
  let target;
  if (isPglite(url)) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    target = db();
    await migrate(target as unknown as Parameters<typeof migrate>[0], { migrationsFolder });
  } else {
    const neonDb = drizzle(neon(url), { schema });
    await migrateNeon(neonDb, { migrationsFolder });
    target = neonDb;
  }

  // Starter content is per learner, copied on first visit (lib/learners/provision.ts).
  // A deploy refreshes it for everyone already set up, so seed-file edits reach them.
  console.log("db:prepare — refreshing learners' starter content…");
  const n = await refreshLearners(target, (line) => console.log(`db:prepare — ${line}`));
  console.log(`db:prepare — ${n} learner track(s) refreshed.`);
}

main().catch((err) => {
  console.error("db:prepare failed:", err);
  process.exit(1);
});
