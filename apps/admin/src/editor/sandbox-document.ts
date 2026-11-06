// Документ изолированного предпросмотра: страница со своими скриптами внутри
// <iframe sandbox="allow-scripts"> без allow-same-origin. У такого документа непрозрачный источник
// (opaque origin): cookie и localStorage админки ему недоступны, запросы к /api уходят без cookie
// сессии и не читаются, родительское окно — чужой источник. Сверх этого CSP в самом документе:
// никаких запросов (connect-src 'none'), форм (form-action 'none') и фреймов. Решение — документация
// «Решения → Свой JS на сайте»

/** Права iframe: только скрипты. Без allow-same-origin, allow-forms, allow-popups, allow-top-navigation */
export const SANDBOX_PERMISSIONS = 'allow-scripts'

/** Скрипт для предпросмотра: чей он (сайт или ключ блока) и готовый текст файла, как на сайте */
export type SandboxScript = { label: string; file: string }

/**
 * Свой скрипт предпросмотра — первым: ссылки внутри не уводят рамку (кроме якорей), как в
 * обычном предпросмотре. Без него щелчок по ссылке открыл бы в рамке адрес админки
 */
const GUARD = [
  "document.addEventListener('click', (event) => {",
  "  const link = event.target instanceof Element ? event.target.closest('a[href]') : null",
  "  if (link && !link.getAttribute('href').startsWith('#')) event.preventDefault()",
  '})',
].join('\n')

/** Модуль из data: URL — код не вставляется в HTML, экранировать в нём нечего */
const moduleTag = (code: string) =>
  `<script type="module" src="data:text/javascript;charset=utf-8,${encodeURIComponent(code)}"></script>`

/** Политика документа предпросмотра: стили, картинки и шрифты — с админки, скрипты — только data: */
export function sandboxCsp(origin: string) {
  return [
    "default-src 'none'",
    'script-src data:',
    `style-src 'unsafe-inline' ${origin}`,
    `img-src ${origin} data: blob:`,
    `font-src ${origin} data:`,
    `media-src ${origin}`,
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
  ].join('; ')
}

const attribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

/**
 * HTML документа предпросмотра. head — готовые стили (<style>, <link>), body — разметка страницы
 * (те же блоки, что на сайте). Скрипты — после разметки: на сайте они тоже выполняются, когда HTML
 * уже разобран
 */
export function sandboxDocument(input: {
  origin: string
  lang?: string
  head: string
  body: string
  scripts: readonly SandboxScript[]
}) {
  const scripts = [GUARD, ...input.scripts.map((script) => script.file)].map(moduleTag).join('')
  return [
    '<!doctype html>',
    `<html lang="${attribute(input.lang ?? 'ru')}">`,
    '<head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${attribute(sandboxCsp(input.origin))}">`,
    input.head,
    '</head>',
    `<body>${input.body}${scripts}</body>`,
    '</html>',
  ].join('')
}
