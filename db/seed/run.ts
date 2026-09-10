import { inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms } from "@/db/schema";
import {
  chunkLinks,
  chunksToRows,
  frequencyToRows,
  grammarToRows,
  validateSeed,
  type ChunkEntry,
  type FrequencyEntry,
  type GrammarEntry,
} from "@/lib/atoms/seed";

export interface SeedFiles {
  freq: FrequencyEntry[];
  chunks: ChunkEntry[];
  grammar: GrammarEntry[];
}

export interface SeedResult {
  upserted: number;
  linked: number;
  unglossed: number;
}

/**
 * Upsert the starter atoms. Idempotent: re-running refreshes glosses, forms,
 * POS, and ranks on existing atoms and never touches memory state. Chunks are
 * linked to their component word and grammar atoms by key after insert.
 */
export async function seedAtoms(d: Db, files: SeedFiles): Promise<SeedResult> {
  const { freq, chunks, grammar } = files;
  const problems = validateSeed(freq, chunks, grammar);
  if (problems.length) {
    throw new Error("Seed files are inconsistent:\n  " + problems.join("\n  "));
  }

  const rows = [...frequencyToRows(freq), ...chunksToRows(chunks), ...grammarToRows(grammar)];
  for (let i = 0; i < rows.length; i += 500) {
    await d
      .insert(atoms)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [atoms.lang, atoms.type, atoms.key],
        set: {
          forms: sql`excluded.forms`,
          gloss: sql`excluded.gloss`,
          pos: sql`excluded.pos`,
          gender: sql`excluded.gender`,
          frequencyRank: sql`excluded.frequency_rank`,
          // Keep a generated explanation if one exists; otherwise take the seed's.
          explanation: sql`coalesce(${atoms.explanation}, excluded.explanation)`,
        },
      });
  }

  const links = chunkLinks(chunks);
  const wanted = new Set<string>();
  for (const { words, grammar: g } of links.values()) {
    words.forEach((w) => wanted.add(w));
    g.forEach((k) => wanted.add(k));
  }
  const related = wanted.size
    ? await d
        .select({ id: atoms.id, type: atoms.type, key: atoms.key })
        .from(atoms)
        .where(inArray(atoms.key, [...wanted]))
    : [];
  const idByTypeKey = new Map(related.map((r) => [`${r.type}:${r.key}`, r.id]));

  let linked = 0;
  for (const [key, { words, grammar: g }] of links) {
    const ids = [
      ...words.map((w) => idByTypeKey.get(`word:${w}`)),
      ...g.map((k) => idByTypeKey.get(`grammar:${k}`)),
    ].filter((x): x is string => Boolean(x));
    await d
      .update(atoms)
      .set({ relatedAtoms: ids })
      .where(sql`${atoms.type} = 'chunk' and ${atoms.key} = ${key}`);
    linked++;
  }

  return { upserted: rows.length, linked, unglossed: freq.filter((f) => !f.gloss).length };
}
