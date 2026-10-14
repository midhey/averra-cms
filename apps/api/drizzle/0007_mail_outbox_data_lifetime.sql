ALTER TABLE "mail_outbox" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
-- Данные отправленных писем больше не нужны, а в письмах со ссылкой-токеном они опасны и после неудачи: стираем перед проверкой
UPDATE "mail_outbox" SET "data" = NULL WHERE "status" = 'sent' OR ("status" = 'failed' AND "template" IN ('password-reset', 'invitation'));--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_data_lifetime" CHECK (("mail_outbox"."status" IN ('pending', 'sending') AND "mail_outbox"."data" IS NOT NULL) OR ("mail_outbox"."status" = 'sent' AND "mail_outbox"."data" IS NULL) OR "mail_outbox"."status" = 'failed');
