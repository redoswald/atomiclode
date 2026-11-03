CREATE TABLE "introductions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"atom_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"first_time_right" boolean NOT NULL,
	"attempts" integer NOT NULL,
	"misses" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_atom_id_atoms_id_fk" FOREIGN KEY ("atom_id") REFERENCES "public"."atoms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "introductions_atom_idx" ON "introductions" USING btree ("atom_id");--> statement-breakpoint
CREATE INDEX "introductions_user_due_idx" ON "introductions" USING btree ("user_id","due");