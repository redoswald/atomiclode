ALTER TABLE "atoms" ADD COLUMN "romanization" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "lang" text DEFAULT 'fr' NOT NULL;--> statement-breakpoint
ALTER TABLE "passages" ADD COLUMN "lang" text DEFAULT 'fr' NOT NULL;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "lang" text DEFAULT 'fr' NOT NULL;--> statement-breakpoint
ALTER TABLE "sentences" ADD COLUMN "lang" text DEFAULT 'fr' NOT NULL;