-- Отключённый доступ участника (раздел «Участники»): NULL — доступ есть. Прошлая версия колонку
-- не знает: у отключённого нет сессий и строк site_members, так что и после отката сайта он не видит
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
-- Роль до отключения: вернуть доступ администратор сайта может только бывшему редактору
ALTER TABLE "users" ADD COLUMN "disabled_role" text;