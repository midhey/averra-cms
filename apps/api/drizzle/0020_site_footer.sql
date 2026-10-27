ALTER TABLE "leads" ADD COLUMN "source" text DEFAULT 'block' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "footer_published" jsonb;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "footer_draft" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_valid" CHECK ("leads"."source" IN ('block', 'footer'));--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_footer_published_object" CHECK ("sites"."footer_published" IS NULL OR jsonb_typeof("sites"."footer_published") = 'object');--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_footer_draft_object" CHECK ("sites"."footer_draft" IS NULL OR jsonb_typeof("sites"."footer_draft") = 'object');