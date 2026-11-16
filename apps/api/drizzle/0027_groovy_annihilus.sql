CREATE TABLE "site_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_revisions_version_positive" CHECK ("site_revisions"."version" > 0),
	CONSTRAINT "site_revisions_entity_valid" CHECK ("site_revisions"."entity" IN ('header', 'footer', 'theme', 'script'))
);
--> statement-breakpoint
ALTER TABLE "site_revisions" ADD CONSTRAINT "site_revisions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_revisions" ADD CONSTRAINT "site_revisions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_revisions_entity_version_unique" ON "site_revisions" USING btree ("site_id","entity","version");