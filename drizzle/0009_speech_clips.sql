CREATE TABLE "speech_clips" (
	"key" text PRIMARY KEY NOT NULL,
	"lang" text NOT NULL,
	"voice" text NOT NULL,
	"rate" text NOT NULL,
	"text" text NOT NULL,
	"url" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
