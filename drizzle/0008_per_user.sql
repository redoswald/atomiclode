-- Per-user data. Rows written before this migration belong to the nil-uuid
-- learner (LOCAL_USER in lib/auth.ts); the first sign-in by LEGACY_OWNER_EMAIL
-- claims them (lib/learner.ts). Caches (why_cache, context_glosses,
-- sentence_translations) and goal_coverage (through goals) carry no user_id.
CREATE TABLE "learners" (
	"user_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	CONSTRAINT "learners_user_id_lang_pk" PRIMARY KEY("user_id","lang")
);
--> statement-breakpoint
DROP INDEX "atoms_lang_type_key_idx";--> statement-breakpoint
DROP INDEX "atoms_status_due_idx";--> statement-breakpoint
DROP INDEX "scenarios_slug_idx";--> statement-breakpoint
ALTER TABLE "atoms" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "atoms" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "encounters" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "passages" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "passages" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "produce_prompts" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "produce_prompts" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "review_events" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_events" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "scenario_visits" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "scenario_visits" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "scenarios" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "sentences" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "sentences" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "atoms_user_lang_type_key_idx" ON "atoms" USING btree ("user_id","lang","type","key");--> statement-breakpoint
CREATE INDEX "atoms_user_status_due_idx" ON "atoms" USING btree ("user_id","status","due");--> statement-breakpoint
CREATE INDEX "encounters_user_at_idx" ON "encounters" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "passages_user_lang_idx" ON "passages" USING btree ("user_id","lang");--> statement-breakpoint
CREATE INDEX "review_events_user_at_idx" ON "review_events" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "scenarios_user_slug_idx" ON "scenarios" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "sentences_user_lang_idx" ON "sentences" USING btree ("user_id","lang");--> statement-breakpoint
INSERT INTO "learners" ("user_id", "lang", "ready_at") SELECT DISTINCT '00000000-0000-0000-0000-000000000000'::uuid, "lang", now() FROM "atoms";
