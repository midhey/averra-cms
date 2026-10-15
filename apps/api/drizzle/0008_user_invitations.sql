CREATE TABLE "user_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"accepted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_invitations_role_valid" CHECK ("user_invitations"."role" IN ('editor', 'client')),
	CONSTRAINT "user_invitations_email_lower" CHECK ("user_invitations"."email" = lower("user_invitations"."email")),
	CONSTRAINT "user_invitations_expires_valid" CHECK ("user_invitations"."expires_at" > "user_invitations"."created_at"),
	CONSTRAINT "user_invitations_one_outcome" CHECK ("user_invitations"."accepted_at" IS NULL OR "user_invitations"."revoked_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_invitations_site_id_idx" ON "user_invitations" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_invitations_open_unique" ON "user_invitations" USING btree ("site_id","email") WHERE "user_invitations"."accepted_at" IS NULL AND "user_invitations"."revoked_at" IS NULL;