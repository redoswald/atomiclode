CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"daily_goal" integer DEFAULT 40 NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"kind" text NOT NULL,
	"amount" real NOT NULL,
	"ref" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "xp_events_user_at_idx" ON "xp_events" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_events_user_kind_ref_idx" ON "xp_events" USING btree ("user_id","kind","ref");