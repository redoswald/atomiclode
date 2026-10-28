/**
 * "Why?" (SPEC §7): one model call per (atom, sentence), cached forever.
 * Generic explanations also live on atoms.explanation. The model function is
 * injectable so the caching and grammar-atom flow can be tested offline.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, whyCache } from "@/db/schema";
import { explain as explainWithModel, type WhyAtom, type WhyInput, type WhyResult } from "@/lib/llm/why";
import { normalizeFor, type Lang } from "@/lib/lang";

export interface WhyRequest {
  lang?: Lang;
  atomId?: string;
  /** Used when no atom exists yet (an unmined word in the reader). */
  lemma?: string;
  surface?: string;
  sentence?: string;
}

export interface WhyAnswer extends WhyResult {
  cached: boolean;
}

export type ExplainFn = (input: WhyInput) => Promise<WhyResult>;

export async function askWhy(d: Db, req: WhyRequest, explain: ExplainFn = explainWithModel): Promise<WhyAnswer> {
  const sentence = (req.sentence ?? "").trim();
  const lang: Lang = req.lang ?? "fr";
  const normalize = normalizeFor(lang);
  let atom: WhyAtom;
  let atomId: string | undefined;
  if (req.atomId) {
    const [row] = await d.select().from(atoms).where(eq(atoms.id, req.atomId));
    if (!row) throw new Error("unknown atom");
    atomId = row.id;
    atom = { key: row.key, type: row.type, forms: row.forms, gloss: row.gloss, pos: row.pos ?? undefined };
    if (!sentence && row.explanation) return { explanation: row.explanation, cached: true, ...(await grammarFor(d, row.key, "")) };
  } else if (req.lemma) {
    const key = lang === "fr" ? normalize(req.lemma) : req.lemma.trim().toLowerCase();
    const candidates = await d.select().from(atoms).where(and(eq(atoms.lang, lang), eq(atoms.type, "word")));
    const row = candidates.find((r) => normalize(r.key) === normalize(key));
    if (row) {
      atomId = row.id;
      atom = { key: row.key, type: row.type, forms: row.forms, gloss: row.gloss, pos: row.pos ?? undefined };
    } else {
      atom = { key, type: "word", forms: req.surface ? [req.surface.toLowerCase()] : [], gloss: "" };
    }
  } else {
    throw new Error("atomId or lemma is required");
  }

  const [hit] = await d.select().from(whyCache).where(and(eq(whyCache.atomKey, atom.key), eq(whyCache.sentence, sentence)));
  if (hit) {
    return {
      explanation: hit.explanation,
      cached: true,
      ...(hit.grammarAtomKey
        ? { grammar: { key: hit.grammarAtomKey, title: hit.grammarTitle ?? hit.grammarAtomKey, explanation: hit.grammarExplanation ?? "", existing: await grammarExists(d, hit.grammarAtomKey) } }
        : {}),
    };
  }

  const concepts = await d
    .select({ key: atoms.key, gloss: atoms.gloss })
    .from(atoms)
    .where(and(eq(atoms.lang, lang), eq(atoms.type, "grammar")));
  const result = await explain({ lang, atom, sentence: sentence || undefined, concepts });

  await d
    .insert(whyCache)
    .values({
      atomKey: atom.key,
      sentence,
      explanation: result.explanation,
      grammarAtomKey: result.grammar?.key ?? null,
      grammarTitle: result.grammar?.title ?? null,
      grammarExplanation: result.grammar?.explanation ?? null,
    })
    .onConflictDoNothing();
  if (atomId && !sentence) {
    await d.update(atoms).set({ explanation: result.explanation }).where(eq(atoms.id, atomId));
  }
  // Link the word to an existing grammar atom it depends on.
  if (atomId && result.grammar?.existing) {
    await linkRelated(d, atomId, result.grammar.key, lang);
  }
  return { ...result, cached: false };
}

async function grammarFor(d: Db, atomKey: string, sentence: string): Promise<Pick<WhyResult, "grammar">> {
  const [hit] = await d.select().from(whyCache).where(and(eq(whyCache.atomKey, atomKey), eq(whyCache.sentence, sentence)));
  if (!hit?.grammarAtomKey) return {};
  return {
    grammar: {
      key: hit.grammarAtomKey,
      title: hit.grammarTitle ?? hit.grammarAtomKey,
      explanation: hit.grammarExplanation ?? "",
      existing: await grammarExists(d, hit.grammarAtomKey),
    },
  };
}

async function grammarExists(d: Db, key: string): Promise<boolean> {
  const [row] = await d.select({ id: atoms.id }).from(atoms).where(and(eq(atoms.type, "grammar"), eq(atoms.key, key)));
  return Boolean(row);
}

async function linkRelated(d: Db, atomId: string, grammarKey: string, lang: Lang = "fr"): Promise<void> {
  const [g] = await d.select({ id: atoms.id }).from(atoms).where(and(eq(atoms.lang, lang), eq(atoms.type, "grammar"), eq(atoms.key, grammarKey)));
  if (!g) return;
  await d
    .update(atoms)
    .set({ relatedAtoms: sql`array(select distinct unnest(array_append(${atoms.relatedAtoms}, ${g.id}::uuid)))` })
    .where(eq(atoms.id, atomId));
}

/**
 * "Add *conditional for polite requests* to your reviews?" — how grammar atoms
 * are born. Idempotent; links the originating atom when given.
 */
export async function addGrammarAtom(
  d: Db,
  input: { lang?: Lang; key: string; title: string; explanation: string; fromAtomId?: string },
): Promise<{ atomId: string; created: boolean }> {
  const lang: Lang = input.lang ?? "fr";
  const key = input.key.trim();
  if (!key) throw new Error("grammar key is required");
  const [existing] = await d.select({ id: atoms.id }).from(atoms).where(and(eq(atoms.lang, lang), eq(atoms.type, "grammar"), eq(atoms.key, key)));
  let id: string;
  let created = false;
  if (existing) {
    id = existing.id;
  } else {
    const [row] = await d
      .insert(atoms)
      .values({ lang, type: "grammar", key, forms: [], gloss: input.title.trim(), explanation: input.explanation.trim() || null, source: "conversation", status: "new" })
      .returning({ id: atoms.id });
    id = row.id;
    created = true;
  }
  if (input.fromAtomId) await linkRelated(d, input.fromAtomId, key, lang);
  return { atomId: id, created };
}

/** Grammar atoms by key, for offers in the UI. */
export async function grammarAtomsByKey(d: Db, keys: string[]) {
  if (keys.length === 0) return new Map<string, { id: string; status: string }>();
  const rows = await d
    .select({ id: atoms.id, key: atoms.key, status: atoms.status })
    .from(atoms)
    .where(and(eq(atoms.type, "grammar"), inArray(atoms.key, keys)));
  return new Map(rows.map((r) => [r.key, { id: r.id, status: r.status }]));
}
