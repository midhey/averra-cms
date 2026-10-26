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
- Раскладка части экрана, которая живёт и в широкой колонке, и в узкой, — по ширине своего
  контейнера: `container-type: inline-size` и `@container (min-width: …)`, как у списка сведений
  (`Facts`). Без поддержки container queries должна остаться рабочая узкая раскладка.
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
- Шкалы отступов и размеров текста (`--space-*`, `--text-*`, `--container`) общие для всех сайтов:
  тема их не меняет, так сохраняется ритм.

### Модель темы

Схема `Theme` в `packages/schema/src/theme.ts`; меняют её на экране [«Тема»](/averra-cms/admin/theme/).

| Поле | Значения | CSS-переменная |
|---|---|---|
| `colors.background` | фон страниц; все цвета — `#RRGGBB` | `--color-background` |
| `colors.surface` | полосы блоков, «Призыв», форма | `--color-surface` |
| `colors.text` | основной текст | `--color-text` |
| `colors.muted` | подписи, рамки полей формы | `--color-muted` |
| `colors.accent` | кнопки, ссылки, фокус | `--color-accent` |
| `colors.onAccent` | текст на кнопках | `--color-on-accent` |
| `colors.border` | рамки карточек «Преимуществ» и окон cookie (декор, без проверки контраста) | `--color-border` |
| `fonts.heading`, `fonts.body` | id из `themeFontIds` | `--font-heading`, `--font-body`, `--font-heading-weight` |
| `radius` | `none`, `small`, `medium`, `large` (0, 4, 8, 16 px) | `--radius` |
| — (из `text` и `background`) | затемнение фото «Первого экрана» на фото: `coverScrim(colors)` | `--cover-scrim` |

- **Контраст** — `themeContrast(colors)` в `@averra/schema`: пары, пороги и какие блокируют
  (`contrastPairs`). `ThemeInput` — `Theme` плюс блокирующие пары: им проверяют и админка, и API
  (`PUT /api/sites/:siteId/theme`). Показ числа — `formatContrast`, с округлением вниз. Почему так —
  [решение](/averra-cms/decisions/theme-contrast/).
- **Каждая переменная цвета** берётся хотя бы одним блоком — это проверяет
  `apps/renderer/src/lib/theme-roles.test.ts`. Новая роль без блока, который ею красит, уронит
  тест: цвет на экране «Тема» менялся бы впустую.
- **Готовые темы** — `themePresets` (`theme-presets.ts`). Новая готовая тема проходит все пары, и
  блокирующие, и предупреждающую: это проверяет `contrast.test.ts`.
- **Из базы** тема читается только `readTheme`: тема до редактора тем (шесть цветов) получает
  линии из текста и фона, незнакомое поле — значение по умолчанию. В колонки — см.
  [Данные](/averra-cms/dev/data/).
- **В CSS** — `themeToCss` из `@averra/tokens`: одна строка `:root{…}` в `<head>` сайта и в
  предпросмотре. Блок берёт только переменные; заголовки — `font-weight:
  var(--font-heading-weight)` (уже в `base.css`).

### Шрифты сайта

Каталог — `fontCatalog` в `packages/tokens/src/fonts.ts`: у своего шрифта семейство, пакет
`@fontsource`, запасной стек, вес заголовков и жирного в тексте; у системного — только стек.
`themeFontFiles(theme)` — файлы темы: тексту 400 и жирный, заголовкам свой вес, подмножества
кириллица и латиница, только WOFF2. Плюс на каждый вес файл latin-ext с `unicode-range: U+20BD`:
у Fontsource знак ₽ лежит только там, а без него цены рисовались бы системным шрифтом. Браузер
качает этот файл, только когда на странице есть ₽. Внешних запросов нет.

- **Сайт** — маршрут `/_fonts/[file].woff2` рендерера (`src/routes/fonts.ts`): при сборке пишет только
  файлы темы, с хешем содержимого в имени; `@font-face` с этими адресами — в `<head>` перед
  переменными темы. Caddy отдаёт `/_fonts/` с кешем на год.
- **Предпросмотр админки** — те же `@font-face`, файлы — адресами Vite (`theme/preview-fonts.ts`).
- Пути к файлам приходят из виртуального модуля `virtual:averra/font-files` — его даёт плагин
  `fontFilesPlugin` из `@averra/tokens/vite` (подключён в `astro.config.mjs` и `vite.config.ts`
  админки). Пакеты шрифтов — зависимости `@averra/tokens`, приложениям перечислять их не нужно.

**Как добавить шрифт:**

1. Проверьте лицензию (OFL или похожая, разрешающая раздавать файлы) и кириллицу на
   [fontsource.org](https://fontsource.org/).
2. Добавьте пакет `@fontsource/<шрифт>` в `packages/tokens/package.json` (версия не моложе суток).
3. Id и подпись — в `themeFontIds` и `themeFontTitles` (`packages/schema/src/theme.ts`).
4. Запись в `fontCatalog`: `family`, `package`, `prefix` (начало имён файлов в `files/` пакета),
   `fallback`, `headingWeight`, `boldWeight` — только веса, которые в пакете есть.
5. `pnpm test`: тест `@averra/tokens` проверит, что каталог совпадает со схемой и каждый файл лежит в
   пакете.

Убрать шрифт так просто нельзя: его могли выбрать в теме. Сначала — значение на замену в
`readTheme`, иначе такие сайты получат системный шрифт.
