CREATE TABLE "why_cache" (
	"atom_key" text NOT NULL,
	"sentence" text DEFAULT '' NOT NULL,
	"explanation" text NOT NULL,
	"grammar_atom_key" text,
	"grammar_title" text,
	"grammar_explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "why_cache_atom_key_sentence_pk" PRIMARY KEY("atom_key","sentence")
);
