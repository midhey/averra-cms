CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"page_id" uuid,
	"page_slug" text NOT NULL,
	"block_id" text NOT NULL,
	"form_title" text NOT NULL,
	"data" jsonb NOT NULL,
	"consent_text" text NOT NULL,
	"consent_policy_url" text NOT NULL,
	"page_version" integer,
	"consented_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_status_valid" CHECK ("leads"."status" IN ('new', 'processed')),
	CONSTRAINT "leads_processed_at_valid" CHECK (("leads"."status" = 'processed') = ("leads"."processed_at" IS NOT NULL)),
	CONSTRAINT "leads_data_array" CHECK (jsonb_typeof("leads"."data") = 'array')
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "lead_recipients" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "lead_retention_days" integer DEFAULT 180 NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "lead_confirmation" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_site_created_idx" ON "leads" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_lead_retention_valid" CHECK ("sites"."lead_retention_days" BETWEEN 7 AND 1825);--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_lead_recipients_array" CHECK (jsonb_typeof("sites"."lead_recipients") = 'array');