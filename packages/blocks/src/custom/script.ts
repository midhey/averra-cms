import { CUSTOM_BLOCK_ATTRIBUTE } from './marker'
import type { CustomBlockProblem } from './problems'

// Свой JS на сайте: скрипт своего блока и скрипт сайта. Код автора — тело async-функции; обёртка
// даёт ему корни блоков и ловит ошибку, чтобы упавший скрипт не мешал остальным. На сайте каждый
// скрипт — отдельный файл (рендерер, /_scripts/), в изолированном предпросмотре админки — модуль из
// data: URL. Решение — документация «Решения → Свой JS на сайте»

/** Конструктор async-функций: только компилирует код автора для проверки, не выполняет его */
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => unknown

/**
 * Ошибка разбора кода как тела async-функции в строгом режиме (как модуль на странице). undefined —
 * код разбирается. Так же ловится import/export: в теле функции их нет, а у модуля-обёртки нет
 * доступа к ним
 */
export function scriptSyntaxError(code: string): string | undefined {
  if (code.trim() === '') return undefined
  try {
    new AsyncFunction('blocks', `'use strict';\n${code}`)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** То, что CSP сайта запретит, — с объяснением */
const BLOCKED_BY_CSP: readonly { pattern: RegExp; message: string }[] = [
  {
    pattern: /\beval\s*\(/,
    message: 'eval на сайте запрещён политикой безопасности (CSP): код не выполнится',
  },
  {
    pattern: /\bnew\s+Function\s*\(/,
    message: 'new Function на сайте запрещён политикой безопасности (CSP): код не выполнится',
  },
  {
    pattern: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/,
    message: 'Строка вместо функции в setTimeout — это eval, CSP его запретит: передайте функцию',
  },
  {
    pattern: /\bdocument\.write(?:ln)?\s*\(/,
    message: 'document.write после разбора страницы стирает её: добавляйте элементы через DOM',
  },
]

/** Номер строки, с которой начинается совпадение */
const lineAt = (code: string, index: number) => code.slice(0, index).split('\n').length

/** Замечания к скрипту: ошибка разбора не даёт опубликовать, остальное — советы */
export function scriptProblems(code: string): CustomBlockProblem[] {
  const problems: CustomBlockProblem[] = []
  const syntax = scriptSyntaxError(code)
  if (syntax) {
    problems.push({
      part: 'script',
      level: 'error',
      message: `Скрипт не разбирается: ${syntax}. Код — тело функции: без import и export`,
    })
  }
  for (const { pattern, message } of BLOCKED_BY_CSP) {
    const match = pattern.exec(code)
    if (match) {
      problems.push({ part: 'script', level: 'warning', message, line: lineAt(code, match.index) })
    }
  }
  return problems
}

/**
 * Код автора — как есть, без отступа: отступ поменял бы многострочные строки-шаблоны. Хвостовые
 * пробелы убираются, а закрывающая скобка обёртки — на своей строке: последний комментарий её не
 * съест
 */
const body = (code: string) => code.replace(/\s+$/, '')

/**
 * Файл скрипта своего блока: blocks — корни блоков этого типа на странице (section с
 * data-custom-block="<ключ>"), в порядке страницы. Ключ — латиница, цифры и дефис (CustomBlockKey):
 * в строку селектора он попадает как есть
 */
export function customBlockScriptFile(key: string, code: string) {
  const label = `своего блока «${key}»`
  return [
    `// Скрипт ${label} (Averra). blocks — корни этих блоков на странице`,
    `const blocks = Array.from(document.querySelectorAll('[${CUSTOM_BLOCK_ATTRIBUTE}="${key}"]'))`,
    ';(async (blocks) => {',
    body(code),
    `})(blocks).catch((error) => console.error('Ошибка в скрипте ${label}:', error))`,
    '',
  ].join('\n')
}

/** Файл скрипта сайта: выполняется на каждой странице */
export function siteScriptFile(code: string) {
  return [
    '// Скрипт сайта (Averra)',
    ';(async () => {',
    body(code),
    `})().catch((error) => console.error('Ошибка в скрипте сайта:', error))`,
    '',
  ].join('\n')
}
