import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Local development without Neon: set DATABASE_URL=pglite://./.pglite to use
 * an embedded Postgres stored in that folder (dev only; PGlite is a dev dependency).
 */
export function isPglite(url = process.env.DATABASE_URL): boolean {
  return Boolean(url?.startsWith("pglite://"));
}

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
  if (isPglite(url)) return createPglite(url);
  return drizzle(neon(url), { schema });
}

let pgliteInstance: Db | undefined;

function createPglite(url: string): Db {
  if (pgliteInstance) return pgliteInstance;
  // Required lazily so the production bundle never pulls PGlite in.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const dir = url.slice("pglite://".length) || "./.pglite";
  pgliteInstance = drizzlePglite(new PGlite(dir), { schema }) as unknown as Db;
  return pgliteInstance;
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
