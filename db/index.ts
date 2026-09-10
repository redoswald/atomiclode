import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Driver-agnostic handle. Production uses Neon over HTTP; tests use PGlite.
 * Query code should take this type rather than calling `db()` directly.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** True when a Postgres connection string is configured. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

let cached: Db | undefined;

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. See .env.example.");
  }
  return drizzle(neon(url), { schema });
}

/**
 * Lazily-created Drizzle client over Neon's HTTP driver. Stateless per query,
 * which suits Vercel's serverless functions; nothing to pool or close.
 */
export function db(): Db {
  cached ??= createDb();
  return cached;
}

export { schema };
