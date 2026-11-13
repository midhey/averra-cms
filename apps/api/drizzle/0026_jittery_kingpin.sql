CREATE TABLE "mail_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"template" text NOT NULL,
	"draft" jsonb,
	"draft_updated_at" timestamp with time zone,
	"draft_updated_by" text,
	"published" jsonb,
	"published_at" timestamp with time zone,
	"published_by" text,
	CONSTRAINT "mail_templates_scope_template_unique" UNIQUE NULLS NOT DISTINCT("site_id","template")
);
--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "custom" jsonb;--> statement-breakpoint
ALTER TABLE "mail_templates" ADD CONSTRAINT "mail_templates_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;