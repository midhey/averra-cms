-- Страницы, опубликованные до появления published_title, могли остаться без заголовка: дозаполняем перед проверкой
UPDATE "pages" SET "published_title" = "title" WHERE "published" IS NOT NULL AND "published_title" IS NULL;--> statement-breakpoint
-- Обратное полусостояние (заголовок без содержимого — после ручной правки) публикацией не считаем: без него проверка не встанет, а API не стартует
UPDATE "pages" SET "published_title" = NULL WHERE "published" IS NULL AND "published_title" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_published_with_title" CHECK (("pages"."published" IS NULL) = ("pages"."published_title" IS NULL));
