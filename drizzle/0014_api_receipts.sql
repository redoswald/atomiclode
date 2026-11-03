CREATE TABLE "api_receipts" (
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"response" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_receipts_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
