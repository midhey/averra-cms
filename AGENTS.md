# AGENTS.md

Правила для агентов, которые пишут код в Averra CMS. Подробности — в документации
(https://midhey.github.io/averra-cms/). Пути ниже:

- `dev/…`, `install/…` — страницы документации, от `apps/docs/src/content/docs/`;
- всё остальное — файлы кода, от корня репозитория.

## Команды

- Запуск: `pnpm install`, `pnpm dev` (API `:4000`, админка `:5173`, рендерер `:4321`) —
  `dev/index.md`. Документация отдельно: `pnpm docs:dev` (`:4330`).
- Все команды pnpm, CLI API, `install.sh`, `averra.sh`, `pnpm fleet` — `dev/commands.md`.
- Переменные окружения — `dev/env.md`.
- Node не ставить и PATH не трогать: Node 24 закреплена в `devEngines.runtime`, pnpm скачивает её
  сам.

## Обязательные проверки

Перед тем как сказать «готово»:

1. `pnpm format` — Biome и stylelint с исправлением.
2. `pnpm check` — линтер, типы, все тесты, сборка документации с проверкой ссылок. Зелёный.
3. `pnpm e2e` — если менялись админка, API или рендерер. Зелёный. Браузер один раз:
   `pnpm --filter @averra/e2e exec playwright install chromium`.

Тест пишется вместе с кодом. Как устроены тесты и e2e — `dev/testing.md`.

## Код

Полные правила — `dev/conventions.md`, `dev/security.md`, `dev/server.md`.

- TypeScript strict, без `any` без причины. Biome: 2 пробела, одинарные кавычки, без `;`, строка до
  100. Файлы `kebab-case`, компоненты `PascalCase`.
- Комментарии и тексты для людей — по-русски; комментарий объясняет «почему», а не «что».
- Zod — единственный источник правды о данных; схемы входа API — в `@averra/schema`
  (`dev/schemas.md`). Id — `Uuid()`, не `z.uuid()`.
- API: маршруты под `/api`, зависимости через `createApp(deps)`, `app.ts` и маршруты без Node API,
  `process.env` только в `apps/api/src/config.ts`, вход через `validate()`, ошибки — единый
  `ApiError` по-русски (`dev/api.md`).
- Доступ: всё закрыто по умолчанию (`apps/api/src/auth/middleware.ts`), права — действием через
  `requireSite` и таблицу `apps/api/src/auth/access.ts`; персональные данные токену API запрещены
  всегда.
- Письма — только через очередь `enqueueMail` в той же транзакции; секреты не печатать и не
  логировать; пароли — скрытым вводом или переменной, не аргументом.
- База: схема меняется только миграциями (`pnpm db:generate`), миграции **только совместимые
  вперёд** (`apps/api/src/db/migrations-compat.test.ts`); в транзакции — только `tx`.
  Таблицы — `dev/data.md`.
- Новый блок — схема в `packages/schema/src/blocks`, компонент с `case` в
  `packages/blocks/src/Page.tsx` и набросок для каталога в `apps/admin/src/editor/BlockSketch.tsx`
  (`dev/blocks.md`). Блоки работают без JavaScript.
- Зависимости: общие — через `catalog:`, версия не моложе суток, скрипты установки — только явной
  записью в `allowBuilds` после чтения скрипта. GitHub Actions — по SHA коммита с версией в
  комментарии.

## Стили

Подробно — `dev/styles.md`.

- Админка: только `.module.scss` с `@use "@averra/ui" as ui;`, только семантические токены
  (`var(--color-text)`, `var(--radius-control)`). Сырые цвета, `--palette-*` и примитивы — только в
  `packages/ui/src/foundation/tokens` и `packages/ui/src/themes`. Медиазапросы —
  `ui.breakpoint()`/`ui.breakpoint-down()`, фокус — `ui.focus-ring`.
- Компоненты — `apps/admin/src/ui`; настоящие `button`/`input` с `label`, видимый фокус, состояние
  не только цветом. Новое состояние — на витрине `/dev/ui`.
- Блоки сайта: CSS Modules на переменных темы, без конкретных цветов.

## Документация

- Поменяли поведение, команду, переменную, маршрут или путь — поправьте страницу в `apps/docs` в том
  же изменении. Команды, переменные и маршруты в документации сверяются с кодом.
- Ссылки между страницами — от корня с `/averra-cms/`; битая ссылка роняет `pnpm check`.
- Рабочие планы шагов — в `.work/` (вне git), не в репозитории.

## Git

- Conventional Commits на английском, ветка `master`. Тип выбирайте по тому, что заметят на
  установке: `feat`, `fix`, `perf`, `revert` поднимают версию и попадают в `CHANGELOG.md`,
  `refactor`, `chore`, `docs`, `test`, `ci`, `build`, `style` — нет. Ломающее для установок
  (ручной шаг на сервере, новая строка `.env`) — `feat!:` и подвал
  `BREAKING CHANGE: <что сделать на сервере>` в конце сообщения: в заметки релиза идёт только он,
  обычный текст тела — нет.
- Версию, теги и `CHANGELOG.md` руками не трогать — их ведёт release-please, версия одна на весь
  продукт (`dev/releases.md`).
- Секреты — только в `.env`. `.mcp.json` — локальный (в `.gitignore`), пример — `.mcp.example.json`.
