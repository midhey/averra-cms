# Averra CMS

Лёгкая CMS студии для быстрых и аккуратных лендингов. Страница — данные из блоков по строгим схемам,
сайт собирается в статический HTML, нейронки работают с теми же схемами через MCP. У каждого
клиента своя установка на его VPS: студия её ставит и сопровождает.

**Документация — https://midhey.github.io/averra-cms/** (исходники — `apps/docs`): установка и
сопровождение, работа в админке, MCP, всё для разработчика, принятые решения и дорожная карта.

## Быстрый старт

Нужен pnpm 12. Node ставить не нужно: pnpm сам скачает закреплённую Node 24.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # учебный владелец для pnpm dev
pnpm dev                                  # API :4000, админка :5173, сайт :4321
```

Вход в админку — `http://localhost:5173`, почта и пароль — `DEV_OWNER_*` из `apps/api/.env`.
Перед коммитом — `pnpm format`, `pnpm check` и, если менялись админка, API или рендерер, `pnpm e2e`.
Подробно — [Запуск](https://midhey.github.io/averra-cms/dev/).

## Что где

| Папка | Что |
|---|---|
| `apps/api` | API: Hono, Drizzle, PostgreSQL (локально PGlite), Better Auth |
| `apps/admin` | админка: React, Vite, `@averra/ui` |
| `apps/renderer` | сборка сайта: Astro |
| `apps/mcp` | MCP-сервер для нейронок |
| `apps/docs` | сайт документации: Astro Starlight |
| `packages/*` | схемы (Zod), блоки, токены темы, основа стилей админки |
| `deploy` | установка на VPS: Dockerfile, Compose, Caddy, `install.sh`, `averra.sh`, `pnpm fleet` |
| `e2e` | сквозные тесты на Playwright |

Правила для агентов, которые пишут код, — [AGENTS.md](AGENTS.md).
