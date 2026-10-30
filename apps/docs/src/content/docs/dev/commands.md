---
title: Команды
description: "Все команды pnpm и команды терминала API: разработка, проверки, пользователи, токены, почта."
sidebar:
  order: 1
---

Справочник для разработчика и студии. После страницы вы найдёте нужную команду и будете знать,
как она называется на сервере.

Команды — скрипты корневого `package.json`, он работает вместо Makefile. pnpm стоит в проекте и
как dev-зависимость, поэтому скрипты вызывают его сами.

## Разработка и проверки

| Команда | Что делает |
|---|---|
| `pnpm dev` | API, админка и рендерер вместе (документация — отдельно) |
| `pnpm check` | линтер, типы, тесты и сборка документации с проверкой ссылок — всё, что нужно перед коммитом |
| `pnpm e2e` | сквозные тесты в браузере (Playwright) — [Тесты](/averra-cms/dev/testing/) |
| `pnpm format` | Biome и stylelint с исправлением |
| `pnpm lint` | Biome для кода и stylelint для `*.scss`, без исправлений |
| `pnpm typecheck` | типы во всех пакетах |
| `pnpm test` | тесты во всех пакетах (Vitest) |
| `pnpm build` | сборка всего: API в `apps/api/dist/server`, админка, рендерер, документация. Рендереру нужен запущенный API: он собирает сайт установки |
| `pnpm docs:dev` | сайт документации на `http://localhost:4330/averra-cms/` |
| `pnpm docs:build` | сборка документации в `apps/docs/dist` с проверкой ссылок |
| `pnpm --filter @averra/docs preview` | собранная документация (после `docs:build`) на `http://localhost:4330/averra-cms/` — с поиском, которого в `docs:dev` нет |
| `pnpm db:generate` | миграция по изменениям в `apps/api/src/db/schema.ts` |

Свой пакет — `pnpm --filter <пакет> <скрипт>`, например `pnpm --filter @averra/api test`.

## Пользователи, сайты, токены, почта

Локально команды открывают базу напрямую: со встроенной базой сначала остановите `pnpm dev`. На
сервере — та же команда собранным файлом в контейнере API:
`docker compose exec api node dist/server/<файл>.js …` из `/opt/averra`.

| Команда | На сервере | Что делает |
|---|---|---|
| `pnpm user:create --email … --name … [--role owner\|member] [--if-missing]` | `user-create.js` | пользователь админки, по умолчанию владелец. `--if-missing` — такой уже есть: выйти без ошибки и не спрашивать пароль |
| `pnpm user:password --email …` | `user-password.js` | новый пароль, все входы пользователя завершаются, ссылки сброса сгорают. Путь вернуть доступ без почты |
| `pnpm member:add --email … --role editor\|client [--site <id>]` | `member-add.js` | доступ к сайту уже заведённому пользователю; повторный вызов меняет роль |
| `pnpm member:invite --email … --role editor\|client [--by <почта владельца>] [--site <id>]` | `member-invite.js` | приглашение письмом, как «Пригласить» в админке. Без `--by` — единственный владелец |
| `pnpm token:create --name … [--by <почта>] [--site <id>] [--blocks-draft]` | `token-create.js` | токен API для MCP, показывается один раз; `--blocks-draft` — право на черновики своих блоков |
| `pnpm token:grant --id <id> --blocks-draft on\|off` | `token-grant.js` | включить или выключить право токена на черновики своих блоков |
| `pnpm token:list` | `token-list.js` | токены без самих токенов: сайт, кто выпустил, когда пользовались, отозван ли |
| `pnpm token:revoke --id <id>` | `token-revoke.js` | отозвать токен |
| `pnpm mail:test --to <адрес>` | `mail-test.js` | проверочное письмо напрямую, по шагам. Проверяет только SMTP из окружения |
| `pnpm --filter @averra/api status [--json]` | `status.js` | состояние установки. На сервере его зовёт `averra.sh status` |
| — | `release-info.js --format github [--current X]` | разбор ответа источника релизов (списка релизов) со stdin в одну строку JSON: последний релиз, заметки и признак «ломающий» за все версии новее `--current`. Только для `averra.sh check-update`: тот запускает его в образе без сети |

Пароль команды спрашивают скрыто или берут из переменной `CMS_USER_PASSWORD` — не аргументом: он
не печатается и не попадает в историю и логи.

`member:invite` ссылку не печатает, но говорит, на какой адрес админки (`ADMIN_URL`) она ведёт.
Ссылку на localhost при почте через SMTP она не ставит вовсе. SMTP из админки, пароль которого API
не расшифрует, почтой не считает и отказывает с той же причиной, что показывает API.

## Установка и студия

| Команда | Где | Что делает |
|---|---|---|
| `bash install.sh …` | сервер | установка и повторный запуск — [Установка](/averra-cms/install/server/) |
| `averra.sh backup [--kind manual\|scheduled]` | сервер | бэкап с проверкой — [Бэкапы](/averra-cms/install/backups/) |
| `averra.sh backups` | сервер | список бэкапов |
| `averra.sh verify <бэкап>` | сервер | проверить бэкап ещё раз |
| `averra.sh restore [--from-s3] <бэкап> [--yes]` | сервер | восстановить |
| `averra.sh update --version X [--yes]` | сервер | обновить с откатом — [Обновления](/averra-cms/install/updates/) |
| `averra.sh status [--json]` | сервер | состояние установки |
| `averra.sh check-update` | сервер | есть ли новая версия: итог — в «Состоянии» ([Обновления](/averra-cms/install/updates/#обновить-из-админки)) |
| `averra.sh install-units` | сервер | поставить или обновить службы systemd и папки: бэкап с проверкой версии, заявки из админки |
| `averra.sh update-request` | сервер | служебная: разобрать заявку из админки и запустить обновление (её зовёт `averra-update-request.service`) |
| `averra.sh update-resume` | сервер | служебная: довести обновление, прерванное перезагрузкой, — закончить или откатить, нового не начинать (её зовёт `averra-update-resume.service` при старте сервера) |
| `averra.sh ensure-dirs` | сервер | служебная: папки, которые монтирует `compose.yaml` этой версии (её зовёт прежний `averra.sh` перед запуском новой версии; договор между версиями) |
| `pnpm fleet status [--file <список>]` | машина студии | состояние всех установок — [Несколько установок](/averra-cms/install/fleet/) |
| `pnpm fleet update --version X [--only имя,…] [--file <список>]` | машина студии | обновить все по очереди |

## Сквозные тесты

```bash
pnpm --filter @averra/e2e exec playwright install chromium   # один раз
pnpm e2e                        # все
pnpm e2e --shuffle              # в случайном порядке
pnpm e2e tests/editor.spec.ts   # один файл
pnpm e2e --headed               # с окном браузера
```
