CREATE TABLE "page_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"published_by" uuid,
	"published_by_token" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_revisions_one_author" CHECK ("page_revisions"."published_by" IS NULL OR "page_revisions"."published_by_token" IS NULL),
	CONSTRAINT "page_revisions_version_positive" CHECK ("page_revisions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "page_revisions" ADD CONSTRAINT "page_revisions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_revisions" ADD CONSTRAINT "page_revisions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_revisions" ADD CONSTRAINT "page_revisions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_revisions" ADD CONSTRAINT "page_revisions_published_by_token_api_tokens_id_fk" FOREIGN KEY ("published_by_token") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_revisions_page_version_unique" ON "page_revisions" USING btree ("page_id","version");--> statement-breakpoint
CREATE INDEX "page_revisions_site_id_idx" ON "page_revisions" USING btree ("site_id");--> statement-breakpoint
-- Уже опубликованные страницы получают версию 1: иначе то, что сейчас на сайте, не было бы видно в истории
INSERT INTO "page_revisions" ("site_id", "page_id", "version", "title", "content", "published_at")
SELECT "site_id", "id", 1, "published_title", "published", COALESCE("published_at", "updated_at")
FROM "pages" WHERE "published" IS NOT NULL;
