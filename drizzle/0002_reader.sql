CREATE TABLE "context_glosses" (
	"lemma" text NOT NULL,
	"sentence" text NOT NULL,
	"gloss" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_glosses_lemma_sentence_pk" PRIMARY KEY("lemma","sentence")
);
--> statement-breakpoint
ALTER TABLE "atoms" ADD COLUMN "marked_known_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "passages" ADD COLUMN "sentence_texts" jsonb DEFAULT '[]'::jsonb NOT NULL;