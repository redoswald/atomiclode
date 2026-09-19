ALTER TYPE "public"."atom_source" ADD VALUE 'scenario';--> statement-breakpoint
ALTER TYPE "public"."atom_source" ADD VALUE 'goal';--> statement-breakpoint
ALTER TYPE "public"."passage_origin" ADD VALUE 'scenario';--> statement-breakpoint
ALTER TYPE "public"."sentence_origin" ADD VALUE 'scenario';--> statement-breakpoint
CREATE TABLE "goal_coverage" (
	"goal_id" uuid NOT NULL,
	"day" text NOT NULL,
	"coverage" real NOT NULL,
	CONSTRAINT "goal_coverage_goal_id_day_pk" PRIMARY KEY("goal_id","day")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"passage_ids" uuid[] DEFAULT '{}' NOT NULL,
	"grammar_atom_ids" uuid[] DEFAULT '{}' NOT NULL,
	"scene_ideas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"surveyed_at" timestamp with time zone,
	"reached_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "produce_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid,
	"situation" text NOT NULL,
	"target_atom_ids" uuid[] DEFAULT '{}' NOT NULL,
	"example_answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"brief" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"passage_id" uuid,
	"translation" text DEFAULT '' NOT NULL,
	"bundle" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"domains" text[] DEFAULT '{}' NOT NULL,
	"origin" text NOT NULL,
	"goal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "atoms" ADD COLUMN "receptive_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "passages" ADD COLUMN "known_at_generation" integer;--> statement-breakpoint
ALTER TABLE "goal_coverage" ADD CONSTRAINT "goal_coverage_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produce_prompts" ADD CONSTRAINT "produce_prompts_visit_id_scenario_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."scenario_visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_visits" ADD CONSTRAINT "scenario_visits_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_visits" ADD CONSTRAINT "scenario_visits_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_visits_scenario_n_idx" ON "scenario_visits" USING btree ("scenario_id","n");--> statement-breakpoint
CREATE UNIQUE INDEX "scenarios_slug_idx" ON "scenarios" USING btree ("slug");