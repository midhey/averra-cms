-- Право токена API на черновики своих блоков: выключено у всех существующих токенов
ALTER TABLE "api_tokens" ADD COLUMN "blocks_draft" boolean DEFAULT false NOT NULL;