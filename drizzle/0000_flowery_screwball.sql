CREATE TYPE "public"."atom_source" AS ENUM('frequency', 'mined', 'conversation', 'manual');--> statement-breakpoint
CREATE TYPE "public"."atom_type" AS ENUM('word', 'chunk', 'grammar');--> statement-breakpoint
CREATE TYPE "public"."memory_status" AS ENUM('new', 'learning', 'review', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."modality" AS ENUM('recognize', 'recall', 'listen', 'produce', 'cloze');--> statement-breakpoint
CREATE TYPE "public"."passage_origin" AS ENUM('imported', 'generated');--> statement-breakpoint
CREATE TYPE "public"."sentence_origin" AS ENUM('generated', 'imported', 'conversation');--> statement-breakpoint
CREATE TABLE "atoms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lang" text DEFAULT 'fr' NOT NULL,
	"type" "atom_type" NOT NULL,
	"key" text NOT NULL,
	"forms" text[] DEFAULT '{}' NOT NULL,
	"gloss" text DEFAULT '' NOT NULL,
	"explanation" text,
	"pos" text,
	"gender" text,
	"frequency_rank" integer,
	"domains" text[] DEFAULT '{}' NOT NULL,
	"related_atoms" uuid[] DEFAULT '{}' NOT NULL,
	"stability" real DEFAULT 0 NOT NULL,
	"difficulty" real DEFAULT 0 NOT NULL,
	"due" timestamp with time zone DEFAULT now() NOT NULL,
	"last_review" timestamp with time zone,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"status" "memory_status" DEFAULT 'new' NOT NULL,
	"modality" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" "atom_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" serial PRIMARY KEY NOT NULL,
	"atom_id" uuid NOT NULL,
	"sentence_id" uuid,
	"passage_id" uuid,
	"tapped" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "explanations" (
	"atom_id" uuid NOT NULL,
	"sentence_id" uuid NOT NULL,
	"text" text NOT NULL,
	"grammar_atom_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "explanations_atom_id_sentence_id_pk" PRIMARY KEY("atom_id","sentence_id")
);
--> statement-breakpoint
CREATE TABLE "passages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"origin" "passage_origin" NOT NULL,
	"source_ref" text,
	"genre" text,
	"text" text NOT NULL,
	"tokens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coverage" real DEFAULT 0 NOT NULL,
	"coverage_at_generation" real DEFAULT 0 NOT NULL,
	"unknown_atoms" uuid[] DEFAULT '{}' NOT NULL,
	"reads" integer DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"atom_id" uuid NOT NULL,
	"modality" "modality" NOT NULL,
	"sentence_id" uuid,
	"grade" smallint NOT NULL,
	"response_ms" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sentences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"translation" text,
	"audio_url" text,
	"atom_ids" uuid[] DEFAULT '{}' NOT NULL,
	"origin" "sentence_origin" NOT NULL,
	"source_ref" text,
	"passage_id" uuid,
	"passage_idx" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_atom_id_atoms_id_fk" FOREIGN KEY ("atom_id") REFERENCES "public"."atoms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_sentence_id_sentences_id_fk" FOREIGN KEY ("sentence_id") REFERENCES "public"."sentences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanations" ADD CONSTRAINT "explanations_atom_id_atoms_id_fk" FOREIGN KEY ("atom_id") REFERENCES "public"."atoms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanations" ADD CONSTRAINT "explanations_sentence_id_sentences_id_fk" FOREIGN KEY ("sentence_id") REFERENCES "public"."sentences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_atom_id_atoms_id_fk" FOREIGN KEY ("atom_id") REFERENCES "public"."atoms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_sentence_id_sentences_id_fk" FOREIGN KEY ("sentence_id") REFERENCES "public"."sentences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentences" ADD CONSTRAINT "sentences_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "atoms_lang_type_key_idx" ON "atoms" USING btree ("lang","type","key");--> statement-breakpoint
CREATE INDEX "atoms_status_due_idx" ON "atoms" USING btree ("status","due");--> statement-breakpoint
CREATE INDEX "atoms_frequency_rank_idx" ON "atoms" USING btree ("frequency_rank");--> statement-breakpoint
CREATE INDEX "encounters_atom_at_idx" ON "encounters" USING btree ("atom_id","at");--> statement-breakpoint
CREATE INDEX "review_events_atom_at_idx" ON "review_events" USING btree ("atom_id","at");--> statement-breakpoint
CREATE INDEX "sentences_passage_idx" ON "sentences" USING btree ("passage_id");