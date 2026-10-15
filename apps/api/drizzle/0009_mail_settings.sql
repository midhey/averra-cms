CREATE TABLE "mail_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"security" text NOT NULL,
	"username" text NOT NULL,
	"password_encrypted" text NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text NOT NULL,
	"verified_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_settings_site_unique" UNIQUE NULLS NOT DISTINCT("site_id"),
	CONSTRAINT "mail_settings_mode_valid" CHECK (("mail_settings"."port" = 465 AND "mail_settings"."security" = 'tls') OR ("mail_settings"."port" = 587 AND "mail_settings"."security" = 'starttls')),
	CONSTRAINT "mail_settings_password_sealed" CHECK ("mail_settings"."password_encrypted" ~ '^v1[.][0-9a-f]{16}[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]+$')
);
--> statement-breakpoint
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;