ALTER TABLE "custom_blocks" ADD COLUMN "script_draft" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_blocks" ADD COLUMN "script_published" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "script_published" jsonb;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "script_draft" jsonb;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_script_published_object" CHECK ("sites"."script_published" IS NULL OR jsonb_typeof("sites"."script_published") = 'object');--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_script_draft_object" CHECK ("sites"."script_draft" IS NULL OR jsonb_typeof("sites"."script_draft") = 'object');