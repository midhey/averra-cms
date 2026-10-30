CREATE TABLE "custom_block_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_block_revisions_version_positive" CHECK ("custom_block_revisions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "custom_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"key" text NOT NULL,
	"draft" jsonb NOT NULL,
	"published" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "custom_blocks_draft_object" CHECK (jsonb_typeof("custom_blocks"."draft") = 'object'),
	CONSTRAINT "custom_blocks_published_object" CHECK ("custom_blocks"."published" IS NULL OR jsonb_typeof("custom_blocks"."published") = 'object'),
	CONSTRAINT "custom_blocks_published_at" CHECK (("custom_blocks"."published" IS NULL) = ("custom_blocks"."published_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "custom_block_revisions" ADD CONSTRAINT "custom_block_revisions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_block_revisions" ADD CONSTRAINT "custom_block_revisions_block_id_custom_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."custom_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_block_revisions" ADD CONSTRAINT "custom_block_revisions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_blocks" ADD CONSTRAINT "custom_blocks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_block_revisions_block_version_unique" ON "custom_block_revisions" USING btree ("block_id","version");--> statement-breakpoint
CREATE INDEX "custom_block_revisions_site_id_idx" ON "custom_block_revisions" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_blocks_site_key_unique" ON "custom_blocks" USING btree ("site_id","key");