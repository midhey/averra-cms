-- Права токена API: публикация и удаление. Новый токен их не получает («только черновики»), а
-- токены, выпущенные до этой миграции, умели это всегда — оставляем им то, что у них было
ALTER TABLE "api_tokens" ADD COLUMN "can_publish" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "can_delete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "api_tokens" SET "can_publish" = true, "can_delete" = true;
