import type { AtomRow, NewAtomRow } from "@/db/schema";
import { emptyModalityStats, type Atom, type MemoryState } from "./types";

/** Database row → in-memory Atom (SPEC §3). */
export function rowToAtom(row: AtomRow): Atom {
  const memory: MemoryState = {
    stability: row.stability,
    difficulty: row.difficulty,
    due: row.due,
    lastReview: row.lastReview ?? undefined,
    reps: row.reps,
    lapses: row.lapses,
    status: row.status,
    learningSteps: row.learningSteps,
    scheduledDays: row.scheduledDays,
  };
  return {
    id: row.id,
    lang: "fr",
    type: row.type,
    key: row.key,
    forms: row.forms,
    gloss: row.gloss,
    explanation: row.explanation ?? undefined,
    pos: row.pos ?? undefined,
    gender: row.gender ?? undefined,
    frequencyRank: row.frequencyRank ?? undefined,
    domains: row.domains,
    relatedAtoms: row.relatedAtoms,
    memory,
    modality: { ...emptyModalityStats(), ...row.modality },
    createdAt: row.createdAt,
    source: row.source,
    markedKnownAt: row.markedKnownAt ?? undefined,
  };
}

/** In-memory Atom → row for insert/update. */
export function atomToRow(atom: Atom): NewAtomRow {
  return {
    id: atom.id,
    lang: atom.lang,
    type: atom.type,
    key: atom.key,
    forms: atom.forms,
    gloss: atom.gloss,
    explanation: atom.explanation ?? null,
    pos: atom.pos ?? null,
    gender: atom.gender ?? null,
    frequencyRank: atom.frequencyRank ?? null,
    domains: atom.domains,
    relatedAtoms: atom.relatedAtoms,
    stability: atom.memory.stability,
    difficulty: atom.memory.difficulty,
    due: atom.memory.due,
    lastReview: atom.memory.lastReview ?? null,
    reps: atom.memory.reps,
    lapses: atom.memory.lapses,
    status: atom.memory.status,
    learningSteps: atom.memory.learningSteps,
    scheduledDays: atom.memory.scheduledDays,
    modality: atom.modality,
    source: atom.source,
    createdAt: atom.createdAt,
    markedKnownAt: atom.markedKnownAt ?? null,
  };
}
