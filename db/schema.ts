import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Modality, ModalityStat } from "@/lib/atoms/types";

// ---- enums -----------------------------------------------------------------

export const atomTypeEnum = pgEnum("atom_type", ["word", "chunk", "grammar"]);
export const atomSourceEnum = pgEnum("atom_source", [
  "frequency",
  "mined",
  "conversation",
  "manual",
]);
export const memoryStatusEnum = pgEnum("memory_status", [
  "new",
  "learning",
  "review",
  "suspended",
]);
export const modalityEnum = pgEnum("modality", [
  "recognize",
  "recall",
  "listen",
  "produce",
  "cloze",
]);
export const sentenceOriginEnum = pgEnum("sentence_origin", [
  "generated",
  "imported",
  "conversation",
]);
export const passageOriginEnum = pgEnum("passage_origin", [
  "imported",
  "generated",
]);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

// ---- passages (declared first: sentences reference it) --------------------

export const passages = pgTable("passages", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title"),
  origin: passageOriginEnum("origin").notNull(),
  sourceRef: text("source_ref"),
  genre: text("genre"),
  /** Raw text as imported or generated; sentences/tokens are derived. */
  text: text("text").notNull(),
  /** Sentence texts in order; tokens refer to them by index. */
  sentenceTexts: jsonb("sentence_texts").$type<string[]>().notNull().default([]),
  /** Token[] from SPEC §5, stored as a blob; recomputed when re-analysed. */
  tokens: jsonb("tokens").$type<PassageToken[]>().notNull().default([]),
  coverage: real("coverage").notNull().default(0),
  coverageAtGeneration: real("coverage_at_generation").notNull().default(0),
  unknownAtoms: uuid("unknown_atoms").array().notNull().default([]),
  reads: integer("reads").notNull().default(0),
  lastReadAt: timestamptz("last_read_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export interface PassageToken {
  /** Whitespace (may include paragraph breaks) before this token. */
  pre: string;
  surface: string;
  lemma: string;
  /** Chunk atom key this token belongs to, when a known chunk matched. */
  chunkKey?: string;
  sentenceIdx: number;
  isWord: boolean;
}

// ---- atoms -----------------------------------------------------------------

export const atoms = pgTable(
  "atoms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lang: text("lang").notNull().default("fr"),
    type: atomTypeEnum("type").notNull(),
    key: text("key").notNull(),
    forms: text("forms").array().notNull().default([]),
    gloss: text("gloss").notNull().default(""),
    explanation: text("explanation"),
    pos: text("pos"),
    gender: text("gender").$type<"m" | "f">(),
    frequencyRank: integer("frequency_rank"),
    domains: text("domains").array().notNull().default([]),
    relatedAtoms: uuid("related_atoms").array().notNull().default([]),

    // MemoryState, flattened so the scheduler can query on due/status.
    stability: real("stability").notNull().default(0),
    difficulty: real("difficulty").notNull().default(0),
    due: timestamptz("due").notNull().defaultNow(),
    lastReview: timestamptz("last_review"),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    status: memoryStatusEnum("status").notNull().default("new"),
    learningSteps: integer("learning_steps").notNull().default(0),
    scheduledDays: real("scheduled_days").notNull().default(0),

    modality: jsonb("modality")
      .$type<Record<Modality, ModalityStat>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    source: atomSourceEnum("source").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    markedKnownAt: timestamptz("marked_known_at"),
  },
  (t) => [
    uniqueIndex("atoms_lang_type_key_idx").on(t.lang, t.type, t.key),
    index("atoms_status_due_idx").on(t.status, t.due),
    index("atoms_frequency_rank_idx").on(t.frequencyRank),
  ],
);

// ---- sentences -------------------------------------------------------------

export const sentences = pgTable(
  "sentences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    text: text("text").notNull(),
    translation: text("translation"),
    audioUrl: text("audio_url"),
    atomIds: uuid("atom_ids").array().notNull().default([]),
    origin: sentenceOriginEnum("origin").notNull(),
    sourceRef: text("source_ref"),
    passageId: uuid("passage_id").references(() => passages.id, { onDelete: "set null" }),
    /** Position within the passage, when it came from one. */
    passageIdx: integer("passage_idx"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("sentences_passage_idx").on(t.passageId)],
);

// ---- review log (append-only) ---------------------------------------------

export const reviewEvents = pgTable(
  "review_events",
  {
    id: serial("id").primaryKey(),
    atomId: uuid("atom_id")
      .notNull()
      .references(() => atoms.id, { onDelete: "cascade" }),
    modality: modalityEnum("modality").notNull(),
    sentenceId: uuid("sentence_id").references(() => sentences.id, { onDelete: "set null" }),
    grade: smallint("grade").notNull(), // 1–4
    responseMs: integer("response_ms").notNull(),
    at: timestamptz("at").notNull().defaultNow(),
  },
  (t) => [index("review_events_atom_at_idx").on(t.atomId, t.at)],
);

// ---- reader exposure log ---------------------------------------------------

export const encounters = pgTable(
  "encounters",
  {
    id: serial("id").primaryKey(),
    atomId: uuid("atom_id")
      .notNull()
      .references(() => atoms.id, { onDelete: "cascade" }),
    sentenceId: uuid("sentence_id").references(() => sentences.id, { onDelete: "set null" }),
    passageId: uuid("passage_id").references(() => passages.id, { onDelete: "set null" }),
    tapped: boolean("tapped").notNull().default(false),
    at: timestamptz("at").notNull().defaultNow(),
  },
  (t) => [index("encounters_atom_at_idx").on(t.atomId, t.at)],
);

// ---- "why?" cache ------------------------------------------------------------
// Generic explanations (sentence = "") also mirror onto atoms.explanation.
// Keyed by atom key + sentence text so the reader can ask before an atom exists.

export const whyCache = pgTable(
  "why_cache",
  {
    atomKey: text("atom_key").notNull(),
    sentence: text("sentence").notNull().default(""),
    explanation: text("explanation").notNull(),
    grammarAtomKey: text("grammar_atom_key"),
    grammarTitle: text("grammar_title"),
    grammarExplanation: text("grammar_explanation"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.atomKey, t.sentence] })],
);

// ---- contextual gloss cache (per lemma + sentence) ---------------------------

export const contextGlosses = pgTable(
  "context_glosses",
  {
    lemma: text("lemma").notNull(),
    sentence: text("sentence").notNull(),
    gloss: text("gloss").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.lemma, t.sentence] })],
);

// ---- sentence translation cache -----------------------------------------------

export const sentenceTranslations = pgTable("sentence_translations", {
  sentence: text("sentence").primaryKey(),
  translation: text("translation").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export type AtomRow = typeof atoms.$inferSelect;
export type NewAtomRow = typeof atoms.$inferInsert;
export type SentenceRow = typeof sentences.$inferSelect;
export type ReviewEventRow = typeof reviewEvents.$inferSelect;
export type PassageRow = typeof passages.$inferSelect;
