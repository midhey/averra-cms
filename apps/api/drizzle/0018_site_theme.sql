ALTER TABLE "sites" ADD COLUMN "theme_published" jsonb;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "theme_draft" jsonb;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_theme_published_object" CHECK ("sites"."theme_published" IS NULL OR jsonb_typeof("sites"."theme_published") = 'object');--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_theme_draft_object" CHECK ("sites"."theme_draft" IS NULL OR jsonb_typeof("sites"."theme_draft") = 'object');