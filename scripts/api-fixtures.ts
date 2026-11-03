/**
 * Write the API v1 contract fixtures (lib/api/v1/fixtures/*.json) the iOS app's
 * tests decode.   npm run api:fixtures
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildFixtures } from "@/lib/api/v1/fixtures";

async function main() {
  const dir = path.join(process.cwd(), "lib", "api", "v1", "fixtures");
  mkdirSync(dir, { recursive: true });
  const fixtures = await buildFixtures();
  for (const [name, value] of Object.entries(fixtures)) writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value, null, 2) + "\n");
  console.log(`wrote ${Object.keys(fixtures).length} fixtures to ${path.relative(process.cwd(), dir)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
