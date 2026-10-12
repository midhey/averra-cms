CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size" integer NOT NULL,
	"variants" jsonb NOT NULL,
	"original_file" text NOT NULL,
	"uploaded_by" uuid,
	"uploaded_by_token" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_mime_type_valid" CHECK ("media"."mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
	CONSTRAINT "media_size_positive" CHECK ("media"."width" > 0 AND "media"."height" > 0 AND "media"."size" > 0),
	CONSTRAINT "media_one_author" CHECK ("media"."uploaded_by" IS NULL OR "media"."uploaded_by_token" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_token_api_tokens_id_fk" FOREIGN KEY ("uploaded_by_token") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_site_id_idx" ON "media" USING btree ("site_id");