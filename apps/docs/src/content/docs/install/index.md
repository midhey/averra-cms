---
title: Установка и сопровождение
description: "Как студия ставит Averra клиенту и как её сопровождает: порядок работ и где что лежит."
sidebar:
  label: Коротко об установке
  order: 0
---

Раздел для студии. После него вы сможете поставить Averra клиенту на чистый VPS, настроить домены
и почту, обновлять установку и восстанавливать её из бэкапа.

У каждого клиента своя установка на его сервере ([почему](/averra-cms/overview/deployment-model/)).
В неё входят PostgreSQL, API и Caddy в Docker Compose. Caddy сам выпускает сертификаты, а
«Опубликовать» в админке собирает сайт прямо на сервере.

## Новая установка по шагам

1. [Подготовить сервер](/averra-cms/install/requirements/): VPS на Ubuntu, два DNS-имени.
2. [Запустить установщик](/averra-cms/install/server/): он проверит сервер, создаст секреты,
   владельца и сайт.
3. [Проверить домены и SSL](/averra-cms/install/domains/).
4. [Настроить почту](/averra-cms/install/mail/): SMTP в админке, SPF, DKIM и DMARC.
5. Сохранить `BACKUP_PASSPHRASE` и, лучше, весь `.env` в менеджер паролей студии, по желанию —
   [внешнее хранилище бэкапов](/averra-cms/install/backups/).
6. Добавить сервер в [список установок студии](/averra-cms/install/fleet/).
7. Для первого клиента на новой версии — пройти [чек-лист живой
   проверки](/averra-cms/install/checklist/).

## Сопровождение

- [Обновления и откат](/averra-cms/install/updates/) — `averra.sh update`.
- [Бэкапы и восстановление](/averra-cms/install/backups/) — по таймеру и руками.
- [Состояние установки](/averra-cms/install/status/) — что проверять и что значат проблемы.
- [Несколько установок](/averra-cms/install/fleet/) — `pnpm fleet status` и `pnpm fleet update`.
- [Персональные данные (152-ФЗ)](/averra-cms/install/personal-data/) — что хранится и сколько.

## Что где на сервере

| Что | Где |
|---|---|
| Папка установки | `/opt/averra` |
| Настройки и секреты | `/opt/averra/.env` (права 600, ведёт установщик) |
| Compose | `/opt/averra/compose.yaml` |
| Управление установкой | `/opt/averra/averra.sh` (только root) |
| Бэкапы | `/opt/averra/backups` (права 700) |
| Итоги бэкапов и обновлений | `/opt/averra/state` (API читает их только на чтение) |
| Лог обновлений | `/opt/averra/update.log` |
| База, медиатека, сайты, сертификаты | тома Docker `postgres`, `media`, `sites`, `caddy_data` |

Команды Docker запускаются из папки установки: `cd /opt/averra && docker compose ps`.
