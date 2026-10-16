ALTER TABLE "mail_outbox" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_lead_id_idx" ON "mail_outbox" USING btree ("lead_id");