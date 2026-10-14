CREATE TABLE "mail_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"template" text NOT NULL,
	"data" jsonb NOT NULL,
	"recipient" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"claim_id" uuid,
	"last_error" text,
	"last_attempt_at" timestamp with time zone,
	"message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_outbox_status_valid" CHECK ("mail_outbox"."status" IN ('pending', 'sending', 'sent', 'failed')),
	CONSTRAINT "mail_outbox_attempts_valid" CHECK ("mail_outbox"."attempts" >= 0),
	CONSTRAINT "mail_outbox_sent_at_valid" CHECK (("mail_outbox"."status" = 'sent') = ("mail_outbox"."sent_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_due_idx" ON "mail_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "mail_outbox_sent_at_idx" ON "mail_outbox" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "mail_outbox_site_id_idx" ON "mail_outbox" USING btree ("site_id");