CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_encrypted" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_channels_kind_unique" UNIQUE("kind"),
	CONSTRAINT "notification_channels_settings_object" CHECK (jsonb_typeof("notification_channels"."settings") = 'object'),
	CONSTRAINT "notification_channels_secret_sealed" CHECK ("notification_channels"."secret_encrypted" IS NULL OR "notification_channels"."secret_encrypted" ~ '^v1[.][0-9a-f]{16}[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]+$')
);
--> statement-breakpoint
CREATE TABLE "notification_link_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"channel" text NOT NULL,
	"site_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"recipient_id" uuid,
	CONSTRAINT "notification_link_codes_codeHash_unique" UNIQUE("code_hash"),
	CONSTRAINT "notification_link_codes_expires_valid" CHECK ("notification_link_codes"."expires_at" > "notification_link_codes"."created_at")
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"lead_id" uuid,
	"recipient_id" uuid,
	"channel" text NOT NULL,
	"address" text NOT NULL,
	"event" text NOT NULL,
	"data" jsonb,
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
	CONSTRAINT "notification_outbox_status_valid" CHECK ("notification_outbox"."status" IN ('pending', 'sending', 'sent', 'failed')),
	CONSTRAINT "notification_outbox_attempts_valid" CHECK ("notification_outbox"."attempts" >= 0),
	CONSTRAINT "notification_outbox_sent_at_valid" CHECK (("notification_outbox"."status" = 'sent') = ("notification_outbox"."sent_at" IS NOT NULL)),
	CONSTRAINT "notification_outbox_data_lifetime" CHECK (("notification_outbox"."status" IN ('pending', 'sending')) = ("notification_outbox"."data" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "notification_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"channel" text NOT NULL,
	"address" text NOT NULL,
	"label" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_recipients_address_unique" UNIQUE NULLS NOT DISTINCT("site_id","channel","address"),
	CONSTRAINT "notification_recipients_events_array" CHECK (jsonb_typeof("notification_recipients"."events") = 'array')
);
--> statement-breakpoint
CREATE TABLE "notification_watch" (
	"key" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raised_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_link_codes" ADD CONSTRAINT "notification_link_codes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_link_codes" ADD CONSTRAINT "notification_link_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_link_codes" ADD CONSTRAINT "notification_link_codes_recipient_id_notification_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."notification_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_recipient_id_notification_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."notification_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_link_codes_expires_idx" ON "notification_link_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "notification_outbox_due_idx" ON "notification_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notification_outbox_lead_id_idx" ON "notification_outbox" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_site_id_idx" ON "notification_outbox" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_recipient_id_idx" ON "notification_outbox" USING btree ("recipient_id");--> statement-breakpoint
-- Адреса уведомлений о заявках переезжают в модуль уведомлений: получатели «Новой заявки» по почте.
-- Колонка sites.lead_recipients остаётся — её читает прежняя версия API при откате
INSERT INTO "notification_recipients" ("site_id", "channel", "address", "events")
SELECT DISTINCT "sites"."id", 'email', lower("recipient"."address"), '["lead.new"]'::jsonb
FROM "sites", jsonb_array_elements_text("sites"."lead_recipients") AS "recipient"("address")
ON CONFLICT DO NOTHING;
