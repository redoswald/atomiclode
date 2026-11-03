/**
 * Refresh every learner's starter content from the seed files. New learners
 * get theirs on first visit (lib/learners/provision.ts); this is for pushing
 * edited seed files to learners already set up without a deploy.
 *
 *   npm run db:seed
 */
import "dotenv/config";
import { db, hasDatabase } from "@/db";
import { refreshLearners } from "@/lib/learners/provision";

async function main() {
  if (!hasDatabase()) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }
  const n = await refreshLearners(db());
  console.log(n ? `${n} learner track(s) refreshed.` : "No learners yet: starter content is copied in on first visit.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
