ALTER TABLE "sites" ADD COLUMN "header_published" jsonb;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "header_draft" jsonb;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_header_published_object" CHECK ("sites"."header_published" IS NULL OR jsonb_typeof("sites"."header_published") = 'object');--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_header_draft_object" CHECK ("sites"."header_draft" IS NULL OR jsonb_typeof("sites"."header_draft") = 'object');