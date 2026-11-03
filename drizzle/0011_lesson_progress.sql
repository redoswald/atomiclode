CREATE TABLE "lesson_progress" (
	"user_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"lesson_id" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plays" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_progress_user_id_lesson_id_pk" PRIMARY KEY("user_id","lesson_id")
);
