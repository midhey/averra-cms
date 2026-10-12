ALTER TABLE "pages" ADD COLUMN "published_title" text;--> statement-breakpoint
-- Уже опубликованные страницы показывали текущий заголовок: считаем его опубликованным
UPDATE "pages" SET "published_title" = "title" WHERE "published" IS NOT NULL;