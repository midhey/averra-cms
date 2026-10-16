ALTER TABLE "leads" ADD COLUMN "data_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Размер данных у заявок, принятых до этой миграции. Текст jsonb чуть длиннее JSON.stringify (пробелы после «:» и «,»), для предела объёма это неважно
UPDATE "leads" SET "data_bytes" = octet_length("data"::text);
