# @averra/ui

Sass-основа админки Averra: foundation из [frontend-kit](https://github.com/midhey/frontend-kit) владельца и тема Averra. Чистый Sass, без React и без знаний о продукте: компоненты живут в `apps/admin/src/ui`.

## Входы

Только через `exports` (условие `sass`, его понимают Vite и тест пакета). Глубоких импортов нет.

| Вход | Что | CSS |
|---|---|---|
| `@use "@averra/ui" as ui;` | Sass API: `config` (`$root-font-size`, `$content-width`, `$gutter`, `$breakpoint-small`, `$breakpoint-medium`), `ui.rem()`, `ui.em()`, `ui.fluid()`, `ui.focus-ring`, `ui.reduced-motion`, `ui.breakpoint(small \| medium \| <длина>)` (от ширины), `ui.breakpoint-down(…)` (уже неё) | нет |
| `@use "@averra/ui/preset";` | токены (primitives, semantic), сброс, базовые правила, утилиты `.visually-hidden`, `.visually-hidden-focusable`, `.skip-link`, `.container` | да |
| `@use "@averra/ui/themes/averra";` | тема Averra: свои палитра, шрифты, радиусы, тени, поля страницы | да |

Подключение в приложении — preset, потом тема (`apps/admin/src/styles/global.scss`). Стиль компонента берёт Sass API и семантические custom properties:

```scss
@use "@averra/ui" as ui;

.notice {
  padding: ui.rem(16);
  color: var(--color-text);
  background: var(--color-surface);
  border: ui.rem(1) solid var(--color-border);
  border-radius: var(--radius-card);
}
```

## Откуда взято

`src/foundation/` — папка `src/styles/foundation/` frontend-kit, коммит `f904954`, с той же раскладкой файлов (`config`, `tools`, `tokens`, `base`, `utilities`, `_index.scss`, `preset.scss`). `tools/check-tokens.ts` — перенос `tools/check-tokens.mjs` и `tools/lib/tokens.mjs` на TypeScript. Конфиг stylelint кита — в корне репозитория (`stylelint.config.mjs`).

Не перенесены: пайплайны шрифтов и картинок (шрифты админки — `@fontsource/*`, картинок в админке нет), интеграция с WordPress, пресеты React и Vue, демо-тема и демо-стили, `src/lib/dom`.

## Что изменено и почему

- **Семантические роли** (`tokens/_semantic.scss`) — добавлены роли, которых не хватило концепту: `--color-surface-sidebar`, `--color-surface-inset`, `--color-surface-accent`, `--color-text-placeholder`, `--color-border-strong` (граница полей 3:1 к фону), `--color-border-subtle`, `--color-primary*` (главная кнопка — отдельная роль от акцента ссылок), статусы `info` и `neutral`, `-indicator` у каждого статуса; роли размеров текста (`--font-size-*`), начертаний, высоты строки, радиусов (`--radius-control|card|inner|item|pill`; `item` — пункт меню, сегмент переключателя, ссылка «к содержимому»), теней (`--shadow-raised|overlay`), раскладки (`--size-control`, `--size-sidebar`, `--space-page-*`, `--space-card`). Значения по умолчанию — на палитре кита.
- **Primitives** (`tokens/_primitives.scss`) — шкала размеров текста `--type-1…8`, `--font-mono`, `--shadow-small` и несколько оттенков палитры для новых ролей.
- **`base/_global.scss`** — `body` берёт размер и высоту строки из ролей (`--font-size-body`, `--line-height-body`) вместо `line-height: 1.6`: у интерфейса текст плотнее, чем у сайта.
- **`tools/_mixins.scss`** — добавлен миксин `breakpoint-down(small | medium | <длина>)`: та же граница, что у `breakpoint()`, но «уже, чем» (`width < …`), без перекрытия — ширина ровно на границе уже «широкая». Нужен правилам только узкого экрана (раскладка редактора, оболочка на телефоне), которые иначе пришлось бы писать через `max-width` с вычитанием пикселя. Граница в JS — `NARROW_SCREEN` в `apps/admin/src/ui/use-media-query.ts`.
- **Комментарии** — по-русски (правило репозитория).
- **`utilities/_accessibility.scss`** — у `.skip-link` радиус роли `--radius-item` вместо примитива `--radius-small`: примитивы формы вне токенов запрещены.
- **Проверка токенов** — кит ловит HEX, `rgb()` и `hsl()`; здесь ещё `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()` и именованные цвета (`white`, `red`…; `transparent` и `currentcolor` можно); системные цвета (`Highlight`, `CanvasText`, устаревшие `WindowText`…) — только внутри `@media (forced-colors: active)`, иначе нарушение вида `system`. Кроме цветов ловит палитру (`--palette-*`) и примитивы радиусов, теней и шкалы текста (`--radius-small|medium|round`, `--shadow-small|surface`, `--type-*`) вне токенов и тем: тема переопределяет роли, и компонент на примитиве она не переключит. Проверяет и `.css`, а не только `.scss`. Модуль не экспортируется: его берут тесты пакета по относительному пути.

Остальное (сброс, `:focus-visible`, `disabled`, `prefers-reduced-motion`, утилиты, Sass API, кроме `breakpoint-down`) — как в ките.

## Тема Averra

`src/themes/_averra.scss`: тёплый светлый фон, белые поверхности, почти чёрный текст, синий акцент, Golos Text и JetBrains Mono. Своя палитра (`--palette-sand-*`, `--palette-ink-*`, …) объявлена в теме, роли ссылаются на неё. Тема переопределяет все цветовые роли foundation — это проверяет тест. Тёмная тема — ещё один блок `[data-theme="dark"]` с теми же ролями; компоненты при этом не меняются.

## Как добавить роль

1. Подходит существующая роль — берём её.
2. Нет — минимальная роль по смыслу (не по виду) в `tokens/_semantic.scss` со значением на палитре кита и такое же значение в теме Averra (тест проверит, что тема покрыла все цветовые роли).
3. Токен компонента — только если семантикой не выразить (как `--status-*` внутри `StatusPill`: локальные переменные, значения — семантические роли).
4. Сырые цвета — только в `src/foundation/tokens/` и `src/themes/`.

## Синхронизация с китом

1. В ките — `git diff f904954..<новый коммит> -- src/styles/foundation tools/lib/tokens.mjs stylelint.config.mjs`.
2. Перенести изменения в `src/foundation/` (раскладка та же), не затирая изменения из списка выше.
3. Поменять коммит в этом README и в шапке `tools/check-tokens.ts`, прогнать `pnpm check` и посмотреть витрину `/dev/ui`.

## Проверки

- `src/check-tokens.test.ts` — граница токенов на образцах и по репозиторию (пакет и все стили админки); старые `.module.css` админки — закрытый список.
- `src/styles.test.ts` — каждый `.scss` пакета и админки компилируется, Sass API не выводит CSS, каждая `var(--…)` объявлена.
- `src/theme.test.ts` — контраст ролей темы (текст 4,5:1, границы полей и кольцо фокуса 3:1), точки статусов различаются по светлоте, тема покрывает все цветовые роли.
- stylelint по `*.scss` — в `pnpm lint`.
