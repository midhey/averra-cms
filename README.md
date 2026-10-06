# CMS для лендингов

Своя система для быстрых и аккуратных лендингов. Что и зачем — в [PLAN.md](PLAN.md), правила кода — в [CONVENTIONS.md](CONVENTIONS.md).

## Запуск

Нужен pnpm 12. Ставить Node под проект не нужно: версия закреплена в `package.json` (`devEngines.runtime`, Node 24 LTS). pnpm скачает её при установке и запускает все скрипты на ней, какая бы Node ни стояла глобально и что бы ни было в PATH. Чтобы запустить сам pnpm, подойдёт любая Node ≥ 18 с corepack: `corepack pnpm …`.

```bash
pnpm install
pnpm dev
```

| Что | Адрес |
|---|---|
| API | http://localhost:4000/api/health |
| Админка | http://localhost:5173 |
| Рендерер | http://localhost:4321 |

## Команды

| Команда | Что делает |
|---|---|
| `pnpm dev` | поднимает API, админку и рендерер |
| `pnpm check` | линтер, типы и тесты — всё, что нужно перед коммитом |
| `pnpm build` | собирает админку и рендерер |
| `pnpm typecheck` | проверяет типы во всех пакетах |
| `pnpm test` | запускает тесты во всех пакетах |
| `pnpm lint` | проверяет линтером и форматтером |
| `pnpm format` | то же, но сразу исправляет |

Команды — это скрипты корневого `package.json`, он работает вместо Makefile. pnpm заодно стоит в проекте как dev-зависимость, чтобы скрипты могли вызывать его сами, даже если глобально pnpm не установлен.

Astro по умолчанию отправляет анонимную телеметрию. Отключить её: `pnpm --filter @cms/renderer exec astro telemetry disable`.

## Структура

```
apps/
  api/        # Hono + Drizzle, локально база — PGlite
  admin/      # React + Vite
  renderer/   # Astro: JSON сайта → статический HTML
packages/
  schema/     # Zod-схемы: блоки, страница, тема
  tokens/     # тема → CSS-переменные
  blocks/     # React-компоненты блоков
```
