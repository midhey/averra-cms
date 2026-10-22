-- averra:compat проверка типа заменяется на более широкую тут же: прежний код пишет только растровые типы, их новая проверка тоже пускает
ALTER TABLE "media" DROP CONSTRAINT "media_mime_type_valid";--> statement-breakpoint
-- averra:compat новая проверка шире прежней (добавлен image/svg+xml): существующие строки и вставки прежнего кода ей удовлетворяют
ALTER TABLE "media" ADD CONSTRAINT "media_mime_type_valid" CHECK ("media"."mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml'));
