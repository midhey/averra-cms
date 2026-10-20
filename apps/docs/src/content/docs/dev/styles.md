---
title: Стили
description: "Стили админки на @averra/ui и frontend-kit, токены, компоненты, и тема сайта."
sidebar:
  order: 8
---

Для разработчика админки и блоков. После страницы вы напишете стиль, который пройдёт проверки,
переживёт смену темы и не сломает вид лендинга в предпросмотре.

В Averra две независимые системы стилей: **админка** — на Sass-основе `@averra/ui`, и **сайт** —
блоки на CSS Modules и теме сайта из `@averra/tokens`. Они не смешиваются.

## Админка: `@averra/ui` и frontend-kit

`packages/ui` — foundation из [frontend-kit](https://github.com/midhey/frontend-kit) владельца
(чистый Sass, без React) и тема Averra. Входы — только через `exports` пакета:

| Вход | Что | CSS |
|---|---|---|
| `@use "@averra/ui" as ui;` | Sass API: `ui.rem()`, `ui.em()`, `ui.fluid()`, `ui.focus-ring`, `ui.reduced-motion`, `ui.breakpoint(small \| medium)`, `ui.breakpoint-down(…)` | нет |
| `@averra/ui/preset` | токены, сброс, базовые правила, утилиты (`.visually-hidden`, `.skip-link`, `.container`) | да |
| `@averra/ui/themes/averra` | тема Averra: тёплый светлый фон, синий акцент, Golos Text и JetBrains Mono | да |

Глубоких импортов нет. Откуда взят foundation, что в нём изменено и как синхронизироваться с
китом — [README пакета](https://github.com/midhey/averra-cms/blob/master/packages/ui/README.md).

### Токены

Слои: **primitives** (палитра, шкалы) → **semantic** (роли: фон, поверхность, текст, граница,
действие, фокус, статусы) → component (только при реальной нужде).

- Стили берут **семантические роли**: `var(--color-text)`, `var(--color-surface)`,
  `var(--radius-control)`, `var(--shadow-raised)`. Шкалу отступов `--space-1…8` брать можно.
- **Нельзя:** сырые цвета (HEX, `rgb()`, `oklch()`, именованные вроде `white`), палитру
  `--palette-*` и примитивы радиусов, теней и текста (`--radius-small`, `--shadow-small`,
  `--type-3`) вне `packages/ui/src/foundation/tokens/` и `packages/ui/src/themes/`. Тема меняет
  роли — такой цвет она не переключит.
- **Системные цвета** (`Highlight`, `CanvasText`, `Canvas`…) — только внутри
  `@media (forced-colors: active)`.
- **Новая роль** — по смыслу, а не по виду (`--color-surface-sidebar`, а не `--color-beige`): в
  `tokens/_semantic.scss` со значением на палитре кита и в теме Averra. Переменная внутри
  компонента (`--status-text` у `StatusPill`) берёт значение только из роли.

### Как писать стиль

- Только `.module.scss` рядом с компонентом, первой строкой `@use "@averra/ui" as ui;`. Ни одного
  `.css` в админке.
- Размеры — `ui.rem()`; медиазапросы — `ui.breakpoint()` (от ширины) и `ui.breakpoint-down()`
  (уже неё), без сырых `@media` по ширине; кольцо фокуса — `ui.focus-ring`; анимации — с
  `ui.reduced-motion`.
- Классы CSS-модулей — `camelCase`; в пакете `ui` — kebab-case и BEM.
- **Глобальный слой** (preset, тема, шрифты) — только в `apps/admin/src/styles/global.scss`. Он
  ставится отдельным `<style data-admin-global>` и **не попадает в предпросмотр**: сброс и токены
  админки не меняют вид лендинга в iframe. Поэтому `:global` в модулях без нужды не пишем — он
  уйдёт в предпросмотр.
- **Шрифты** — свои, из `@fontsource/*`, свои `@font-face` в `styles/_fonts.scss`: только WOFF2,
  кириллица и латиница. Google Fonts и внешних CSS нет.

### Компоненты

`apps/admin/src/ui`: `Button`, `IconButton`, `Icon`, `Field` (`TextInput`, `TextArea`, `Select`),
`Checkbox`, `SegmentedControl`, `Tabs`, `StatusPill`, `Card`, `DataTable`, `EmptyState`,
`InlineAlert`, `Dialog`, `AppShell`, `PageHeader`, `Screen`, `Section`, `SortableList`. Оболочка
экранов — `src/shell`.

- Настоящие `button`/`a`/`input` с `label`; кнопка по умолчанию `type="button"`; кнопка-иконка —
  только `IconButton` с обязательной подписью; иконки — только `Icon`.
- Видимое кольцо фокуса не отключаем. Выбранное и ошибочное видно не только цветом (подпись жирнее,
  галочка, текст ошибки) — и в режиме принудительных цветов. Правило для этого режима кладём внутрь
  того же блока, вложенным `@media (forced-colors: active)`: так оно не слабее по специфичности и
  стоит ниже. Заливка `Highlight` с `forced-color-adjust: none` — только там, где внутри один текст
  (сегмент). Где внутри рисунок (карточка с миниатюрой) — рамка и знак цветом `Highlight`, фон и
  текст отдаём браузеру. Проверка — e2e «принудительные цвета» в `e2e/tests/dev-ui.spec.ts`.
- Поле передаёт `aria-describedby` экрана дальше: `Field` склеивает его с подсказкой, счётчиком и
  ошибкой.
- Новое состояние компонента показываем на **витрине `/dev/ui`** — она есть только в разработке
  (`pnpm dev`, e2e); в сборке её нет, это проверяет тест.

### Проверки в `pnpm check`

- stylelint по `*.scss` (конфиг кита, `stylelint.config.mjs`);
- граница токенов — `packages/ui/src/check-tokens.test.ts`, по всем стилям без исключений;
- каждый `.scss` компилируется, каждая `var(--…)` объявлена — `styles.test.ts`;
- контраст темы — `theme.test.ts`: текст 4,5:1, граница полей и кольцо фокуса 3:1. Поменяли цвет —
  тест скажет, если стало нечитаемо.

## Сайт: блоки и тема

- Блоки — `packages/blocks`, стили на **CSS Modules** и **переменных темы**: `var(--color-accent)`,
  `var(--color-text)`, `var(--space-4)`, `var(--text-sm)`. Конкретных цветов и шрифтов в блоках нет.
- Тема сайта — схема `Theme` в `@averra/schema`: шесть цветов (`#RRGGBB`), шрифты заголовков и
  текста (пока системные: `system`, `humanist`, `serif`) и скругления. `@averra/tokens` превращает её
  в CSS-переменные; шкалы отступов и размеров текста общие для всех сайтов.
- Шрифты сайта — без внешних запросов. Редактора темы в админке пока нет (см. [Дорожную
  карту](/averra-cms/roadmap/)).
