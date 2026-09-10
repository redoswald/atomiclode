CREATE TABLE "sentence_translations" (
	"sentence" text PRIMARY KEY NOT NULL,
	"translation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
