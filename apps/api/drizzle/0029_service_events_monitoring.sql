-- Новые служебные события (сайт не отвечает, сертификат истекает или недействителен) получает
-- каждый получатель установки, который уже подписан хотя бы на одно служебное событие: иначе на
-- работающих установках о падении сайта не узнал бы никто, пока владелец не отметит флажки.
-- Только данные; прежняя версия API лишние id событий в списке просто не использует
UPDATE "notification_recipients"
SET "events" = "events" || (
  SELECT coalesce(jsonb_agg(e), '[]'::jsonb)
  FROM jsonb_array_elements_text('["site.down","certificate.expiring","certificate.invalid"]'::jsonb) AS e
  WHERE NOT "notification_recipients"."events" ? e
)
WHERE "site_id" IS NULL
  AND "events" ?| array['backup.failed','disk.low','build.failed','mail.down','update.requested'];
