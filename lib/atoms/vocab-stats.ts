/**
 * Stats screen (SPEC §8): vocabulary strong / developing / fragile, estimated
 * coverage of a reference corpus, passages read, coverage over time.
 * The reference corpus is the frequency list itself: each lemma's per-million
 * frequency is its share of running text, so "coverage" is the summed share of
 * known lemmas over the summed share of all 3000.
 */
import { and, asc, gte, inArray, min, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, encounters, passages, reviewEvents } from "@/db/schema";
import freq from "@/db/seed/frequency-fr.json";
import type { FrequencyEntry } from "@/lib/atoms/seed";
import { FRAGILE_TAPS, FRAGILE_WINDOW_DAYS } from "@/lib/scheduler/exposure";

export const STRONG_STABILITY_DAYS = 21;

export interface VocabStats {
  total: number; // atoms in learning or review
  strong: number; // stability ≥ 21 days
  developing: number;
  fragile: number; // lapsed recently, or tapped 3+ times in 7 days
  words: number;
  chunks: number;
  grammar: number;
  /** Estimated share of running French text covered by known words, 0–1. */
  corpusCoverage: number;
  passagesRead: number;
  passagesTotal: number;
  /** Cumulative known-word corpus coverage by day, from the review log. */
  series: Array<{ date: string; coverage: number; known: number }>;
}

const DAY_MS = 86_400_000;
const FREQ = freq as FrequencyEntry[];
const SHARE = new Map(FREQ.map((f) => [f.lemma, f.freqPerMillion]));
const TOTAL_SHARE = FREQ.reduce((s, f) => s + f.freqPerMillion, 0);

export function corpusCoverageOf(knownLemmas: Iterable<string>): number {
  let s = 0;
  for (const l of knownLemmas) s += SHARE.get(l) ?? 0;
  return TOTAL_SHARE ? s / TOTAL_SHARE : 0;
}

export async function vocabStats(d: Db, now = new Date()): Promise<VocabStats> {
  const known = await d
    .select({ id: atoms.id, key: atoms.key, type: atoms.type, stability: atoms.stability, lapses: atoms.lapses, lastReview: atoms.lastReview })
    .from(atoms)
    .where(inArray(atoms.status, ["learning", "review"]));

  const windowStart = new Date(now.getTime() - FRAGILE_WINDOW_DAYS * DAY_MS).toISOString();
  const tapRows = await d
    .select({ atomId: encounters.atomId, n: sql<number>`count(*)::int` })
    .from(encounters)
    .where(and(gte(encounters.at, windowStart), sql`${encounters.tapped}`))
    .groupBy(encounters.atomId);
  const taps = new Map(tapRows.map((r) => [r.atomId, r.n]));

  let strong = 0;
  let fragile = 0;
  const counts = { word: 0, chunk: 0, grammar: 0 };
  for (const a of known) {
    counts[a.type]++;
    const recentLapse = a.lapses > 0 && a.lastReview && now.getTime() - new Date(a.lastReview).getTime() < FRAGILE_WINDOW_DAYS * DAY_MS && a.stability < 7;
    if ((taps.get(a.id) ?? 0) >= FRAGILE_TAPS || recentLapse) fragile++;
    else if (a.stability >= STRONG_STABILITY_DAYS) strong++;
  }

  const [pass] = await d
    .select({ total: sql<number>`count(*)::int`, read: sql<number>`count(*) filter (where ${passages.reads} > 0)::int` })
    .from(passages);

  return {
    total: known.length,
    strong,
    developing: known.length - strong - fragile,
    fragile,
    words: counts.word,
    chunks: counts.chunk,
    grammar: counts.grammar,
    corpusCoverage: corpusCoverageOf(known.filter((a) => a.type === "word").map((a) => a.key)),
    passagesRead: pass?.read ?? 0,
    passagesTotal: pass?.total ?? 0,
    series: await coverageSeries(d, now),
  };
}

/**
 * Coverage over time: a word counts as known from the day of its first review
 * (or the day it was marked known). One point per day with a change, plus today.
 */
export async function coverageSeries(d: Db, now = new Date()): Promise<VocabStats["series"]> {
  const firsts = await d
    .select({ atomId: reviewEvents.atomId, first: min(reviewEvents.at) })
    .from(reviewEvents)
    .groupBy(reviewEvents.atomId)
    .orderBy(asc(min(reviewEvents.at)));
  const marked = await d
    .select({ id: atoms.id, key: atoms.key, at: atoms.markedKnownAt })
    .from(atoms)
    .where(and(sql`${atoms.type} = 'word'`, sql`${atoms.markedKnownAt} is not null`));
  const keys = new Map(
    (await d.select({ id: atoms.id, key: atoms.key, type: atoms.type }).from(atoms).where(sql`${atoms.type} = 'word'`)).map((a) => [a.id, a.key]),
  );

  const events: Array<{ day: string; key: string }> = [];
  for (const f of firsts) {
    const key = keys.get(f.atomId);
    if (key && f.first) events.push({ day: f.first.slice(0, 10), key });
  }
  for (const m of marked) if (m.at) events.push({ day: m.at.slice(0, 10), key: m.key });
  events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const seen = new Set<string>();
  const series: VocabStats["series"] = [];
  let share = 0;
  for (const e of events) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    share += SHARE.get(e.key) ?? 0;
    const coverage = TOTAL_SHARE ? share / TOTAL_SHARE : 0;
    const last = series[series.length - 1];
    if (last && last.date === e.day) {
      last.coverage = coverage;
      last.known = seen.size;
    } else {
      series.push({ date: e.day, coverage, known: seen.size });
    }
  }
  const today = now.toISOString().slice(0, 10);
  const last = series[series.length - 1];
  if (!last || last.date !== today) series.push({ date: today, coverage: last?.coverage ?? 0, known: last?.known ?? 0 });
  return series;
}
