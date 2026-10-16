CREATE TABLE "site_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"release" text,
	"error" text,
	"peak_rss_bytes" bigint,
	"requested_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "site_builds_status_valid" CHECK ("site_builds"."status" IN ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "site_builds_result_valid" CHECK (("site_builds"."status" = 'succeeded') = ("site_builds"."release" IS NOT NULL)
        AND ("site_builds"."status" = 'failed') = ("site_builds"."error" IS NOT NULL)
        AND ("site_builds"."status" IN ('succeeded', 'failed')) = ("site_builds"."finished_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "site_builds" ADD CONSTRAINT "site_builds_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_builds_site_requested_idx" ON "site_builds" USING btree ("site_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "site_builds_one_queued" ON "site_builds" USING btree ("site_id") WHERE "site_builds"."status" = 'queued';