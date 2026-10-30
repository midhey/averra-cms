---
title: Монорепозиторий
description: "Пакеты репозитория, кто от кого зависит, версии Node и pnpm, общие зависимости."
sidebar:
  order: 3
---

Для разработчика. После страницы вы будете знать, где лежит нужный код, какой пакет что
импортирует и как добавить зависимость.

## Структура

```
apps/
  api/        # Hono + Drizzle: данные, права, медиатека, почта, заявки, сборка сайта
  admin/      # React + Vite: сайты, редактор с живым предпросмотром, заявки, почта
  renderer/   # Astro: JSON сайта → статический HTML
  mcp/        # MCP-сервер для нейронок поверх API
  docs/       # этот сайт: Astro Starlight → GitHub Pages
packages/
  schema/     # Zod-схемы: блоки, страница, тема, поля форм, входы API, почта, состояние
  blocks/     # React-компоненты блоков: одни и те же в предпросмотре и на сайте
  tokens/     # тема сайта → CSS-переменные
  ui/         # Sass-основа админки: foundation frontend-kit и тема Averra
deploy/       # Dockerfile, compose.yaml, Caddyfile, install.sh, averra.sh, pnpm fleet и их тесты
e2e/          # сквозные тесты на Playwright
```

## Кто кого импортирует

- `@averra/schema` — всем: API, админке, рендереру, MCP, блокам, `deploy`. Это единственный
  источник правды о данных.
- `@averra/blocks` — админке (предпросмотр) и рендереру (сайт). Блоки не знают ни про API, ни
  про админку: данные приходят пропсами. API берёт из него только движок своих блоков
  (`@averra/blocks/custom-engine`, без React): проверку шаблона и CSS при сохранении.
- `@averra/tokens` — рендереру (CSS темы на сайте), админке (та же тема в предпросмотре) и API.
- `@averra/ui` — только админке.
- **Админка и MCP читают типы API** (`AppType` из `apps/api/src/app.ts`) и ходят в него
  типизированным клиентом Hono. Поэтому `app.ts` и модули маршрутов не импортируют Node API:
  иначе сломается проверка типов админки.

Пакеты рабочей области экспортируют исходники `.ts`: отдельной сборки у `schema`, `blocks` и
`tokens` нет. Прод-сборка API (`pnpm --filter @averra/api build`, esbuild) берёт их в бандл.

## Внутри API

```
apps/api/src/
  app.ts            # createApp(deps): маршруты, без Node API
  index.ts          # запуск: конфиг, база, хранилище, почта, сборщик, сервер
  config.ts         # единственное место, где читается process.env
  auth/             # Better Auth, права (access.ts), middleware, повторный пароль
  modules/<имя>/    # routes.ts — HTTP и проверка входа, repo.ts — запросы, service.ts — логика
  mail/             # Mailer, очередь (outbox), шаблоны, SMTP
  media/            # MediaStorage, ImageProcessor (sharp), очистка SVG (saxes)
  publish/          # очередь сборок, процесс Astro, папки релизов
  db/               # схема Drizzle, клиент, замок PGlite, тесты миграций
  cli/              # команды терминала
  testing.ts        # createTestApi() для тестов
```

Миграции — `apps/api/drizzle`, API применяет их сам при старте. Таблицы и что в них хранится —
[Модель данных](/averra-cms/dev/data/).

## Версии

- **Node** закреплена в `devEngines.runtime` каждого пакета (24 LTS). pnpm скачивает её сам.
- **pnpm** закреплён в двух местах: `packageManager` (им идёт установка) и `devDependencies` (его
  вызывают скрипты). Версии совпадают.
- **Образ API** — на той же Node: поменялась версия Node в проекте — меняется и `NODE_IMAGE` в
  `deploy/Dockerfile`, и `node-version` в `.github/workflows`. Базовые образы — с точной версией,
  без `latest`.

## Зависимости

- Общие зависимости (`typescript`, `hono`, `zod`, `react`, `astro`, `sass`, `sharp`, `vitest`,
  `@types/node` и другие) — через `catalog:` в `pnpm-workspace.yaml`: одна версия на весь
  репозиторий. Для `hono` это особенно важно: API и админка должны видеть одни и те же типы.
- Новая версия зависимости — не моложе суток: pnpm 12 не ставит более свежие (`minimumReleaseAge`).
  Исключения — поштучно и с версией в `minimumReleaseAgeExclude` (`pnpm-workspace.yaml`).
- **Скрипты установки запрещены** по умолчанию. Разрешённые перечислены в `allowBuilds` — добавлять
  только после чтения самого скрипта.
- Перед выбором библиотеки — её актуальная документация, а не память.
