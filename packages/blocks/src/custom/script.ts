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
 * Создаёт стрелку-обёртку в глобальной области, как в файле на сайте: у стрелки нет своего
 * new.target, как у модуля. Код автора не выполняется. Вызывать только после проверки тела
 * отдельно (новый AsyncFunction в scriptSyntaxError): тело, которое разбирается само по себе, не
 * может выйти за скобки обёртки, поэтому eval здесь лишь строит функцию и ничего не запускает
 */
const compileWrapped = (code: string) =>
  // biome-ignore lint/security/noGlobalEval: только строит функцию, код автора не выполняется
  globalThis.eval(`(async (blocks) => {'use strict';\n${code}\n})`)

/** Вставка, которой нет в корректном коде: там, где она стоит в коде, он перестаёт разбираться */
const PLUG = '@@@@'

/** Правка кода: на месте `at` длиной `size` ставится `insert` */
type Edit = { at: number; size: number; insert: string }

/**
 * Разбирается ли код, если во всех местах `edits` стоит вставка. Все кандидаты — одним разбором:
 * код без вставок разбирается, а вставка не ломает ни строку, ни шаблон, ни комментарий, поэтому
 * разбор падает, только если хоть один кандидат стоит в коде. Одна проба на все совпадения: по
 * пробе на каждое давала O(совпадения × размер) и позволяла 20-КБ скриптом занять процессор на
 * десятки секунд
 */
function compilesWith(code: string, edits: readonly Edit[]) {
  let text = code
  for (const { at, size, insert } of [...edits].sort((a, b) => b.at - a.at)) {
    text = text.slice(0, at) + insert + text.slice(at + size)
  }
  try {
    compileWrapped(text)
    return true
  } catch {
    return false
  }
}

/**
 * На сайте код — модуль, а компиляция выше — обычный скрипт. Два отличия, которые скрипт
 * пропускает, а модуль нет, и которые ловим по признакам (полный разбор модуля потребовал бы
 * парсера в админке; остальные отличия — import/export и new.target — ловит сама компиляция).
 * Совпадение «в коде, а не в тексте» узнаём вставкой (см. compilesWith)
 *
 * - HTML-комментарии `<!--` и `-->` (`-->` — в начале строки или после многострочного
 *   комментария): в модуле это ошибка;
 * - `await` как имя во вложенной не-async функции: в модуле слово зарезервировано везде
 */
function moduleOnlyProblem(code: string) {
  const comments: Edit[] = []
  for (const match of code.matchAll(/<!--|(?:^|\*\/)[ \t]*-->/gm)) {
    const size = match[0].endsWith('-->') ? 3 : 4
    comments.push({ at: match.index + match[0].length - size, size, insert: PLUG.slice(0, size) })
  }
  if (comments.length > 0 && !compilesWith(code, comments)) {
    return 'HTML-комментарии <!-- и --> в коде модуль не разбирает: используйте // или /* */'
  }
  // Голое «await = 1» не ищем: так выглядит и поле класса (`class A { await = 1 }`), корректное
  // для модуля. Деструктуринг и сокращённое свойство —
  // `{ await, a }`, `{ a, await }`, `{ await } = …`
  const awaitName =
    /\b(?:const|let|var|function|class)\s+await\b|[(,]\s*await\s*(?=[,)=}])|\{\s*await\s*(?=,)|\{\s*await\s*\}\s*=(?!=)|\bawait\s*=>/g
  const names: Edit[] = []
  for (const match of code.matchAll(awaitName)) {
    names.push({ at: match.index + match[0].indexOf('await'), size: 0, insert: '@' })
  }
  if (names.length > 0 && !compilesWith(code, names)) {
    return '«await» в модуле нельзя использовать как имя: переименуйте переменную или параметр'
  }
  return undefined
}

/**
 * Ошибка разбора кода как тела async-функции в строгом режиме (как модуль на странице). undefined —
 * код разбирается. Так же ловится import/export: в теле функции их нет, а у модуля-обёртки нет
 * доступа к ним. Отдельно — то, что скрипт разбирает, а модуль нет (см. moduleOnlyProblem)
 */
export function scriptSyntaxError(code: string): string | undefined {
  if (code.trim() === '') return undefined
  try {
    new AsyncFunction(
      'blocks',
      `'use strict';
${code}`,
    )
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  try {
    compileWrapped(code)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return moduleOnlyProblem(code)
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
