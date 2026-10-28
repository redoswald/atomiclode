import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms } from "@/db/schema";
import { chunkLinks, chunksToRows, frequencyToRows, grammarToRows, validateSeed, type ChunkEntry, type GrammarEntry, type WordEntry } from "@/lib/atoms/seed";
import type { Lang } from "@/lib/lang";

export interface SeedFiles {
  freq: WordEntry[];
  chunks: ChunkEntry[];
  grammar: GrammarEntry[];
}

export interface SeedResult {
  upserted: number;
  linked: number;
  unglossed: number;
}

/**
 * Upsert the starter atoms for one language. Idempotent: re-running refreshes
 * glosses, forms, POS, and ranks on existing atoms and never touches memory
 * state. Chunks are linked to their component word and grammar atoms by key.
 */
export async function seedAtoms(d: Db, files: SeedFiles, lang: Lang = "fr"): Promise<SeedResult> {
  const { freq, chunks, grammar } = files;
  const problems = validateSeed(freq, chunks, grammar);
  if (problems.length) {
    throw new Error(`Seed files (${lang}) are inconsistent:\n  ` + problems.join("\n  "));
  }

  const rows = [...frequencyToRows(freq, lang), ...chunksToRows(chunks, lang), ...grammarToRows(grammar, lang)];
  for (let i = 0; i < rows.length; i += 500) {
    await d
      .insert(atoms)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [atoms.lang, atoms.type, atoms.key],
        set: {
          forms: sql`excluded.forms`,
          // Never blank a gloss that was filled in the app after the seed file was written.
          gloss: sql`case when excluded.gloss = '' then ${atoms.gloss} else excluded.gloss end`,
          pos: sql`excluded.pos`,
          gender: sql`excluded.gender`,
          romanization: sql`coalesce(excluded.romanization, ${atoms.romanization})`,
          frequencyRank: sql`excluded.frequency_rank`,
          receptiveOnly: sql`excluded.receptive_only`,
          domains: sql`case when array_length(excluded.domains, 1) is null then ${atoms.domains} else excluded.domains end`,
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
        .where(and(eq(atoms.lang, lang), inArray(atoms.key, [...wanted])))
    : [];
  const idByTypeKey = new Map(related.map((r) => [`${r.type}:${r.key}`, r.id]));

  let linked = 0;
  for (const [key, { words, grammar: g }] of links) {
    const ids = [...words.map((w) => idByTypeKey.get(`word:${w}`)), ...g.map((k) => idByTypeKey.get(`grammar:${k}`))].filter(
      (x): x is string => Boolean(x),
    );
    await d
      .update(atoms)
      .set({ relatedAtoms: ids })
      .where(and(eq(atoms.lang, lang), eq(atoms.type, "chunk"), eq(atoms.key, key)));
    linked++;
  }

  return { upserted: rows.length, linked, unglossed: freq.filter((f) => !f.gloss).length };
}
