ALTER TABLE "mail_outbox" ADD COLUMN "recipient_key" text;--> statement-breakpoint
-- Ключ ящика у писем, поставленных до этой миграции: нижний регистр и без метки «+». Полное правило (gmail без точек, домены Яндекса, punycode) — в mailboxKey у новых писем; разница может дать лишнее подтверждение только в первые сутки после обновления
UPDATE "mail_outbox" SET "recipient_key" = lower(regexp_replace("recipient", '^([^+@]+)\+[^@]*@', '\1@'));--> statement-breakpoint
CREATE INDEX "mail_outbox_recipient_key_idx" ON "mail_outbox" USING btree ("site_id","recipient_key","created_at");
