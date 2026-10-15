import { DrizzleQueryError } from 'drizzle-orm'

// Ошибка для лога сервера. У ошибки запроса к базе (DrizzleQueryError) в тексте, а значит и
// в стеке, — параметры запроса («Failed query: … params: …»), а у её причины из Postgres в detail —
// строка целиком («Failing row contains (…)»). Там бывают секреты и персональные данные:
// зашифрованный пароль SMTP, адреса, данные писем. Без Node API: модуль подключает app.ts

/** Глубже по цепочке причин не идём: так длинных цепочек не бывает, а цикл не повесит лог */
const MAX_DEPTH = 5

function hasQueryError(error: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH || !(error instanceof Error)) return false
  return error instanceof DrizzleQueryError || hasQueryError(error.cause, depth + 1)
}

/** Строки стека «at …» — без заголовка с текстом ошибки */
function framesOf(error: Error) {
  const stack = error.stack ?? ''
  const header = `${error.name}: ${error.message}`
  const rest = stack.startsWith(header) ? stack.slice(header.length) : stack
  return rest.split('\n').filter((line) => /^\s+at /.test(line))
}

function describe(error: unknown, depth: number): string[] {
  if (!(error instanceof Error)) return [`(не Error: ${typeof error})`]
  const code = (error as { code?: unknown }).code
  const head =
    error instanceof DrizzleQueryError
      ? `Запрос к базе не выполнен: ${error.query}`
      : `${error.name}: ${error.message}${typeof code === 'string' ? ` (код ${code})` : ''}`
  const lines = [head, ...framesOf(error)]
  if (error.cause !== undefined && depth < MAX_DEPTH) {
    const [first = '', ...rest] = describe(error.cause, depth + 1)
    lines.push(`Причина: ${first}`, ...rest)
  }
  return lines
}

/**
 * Что писать в лог об ошибке. Если в ней или в цепочке её причин есть ошибка запроса к базе —
 * текст без параметров и без подробностей Postgres: запрос с плейсхолдерами ($1, $2…),
 * сообщение и код ошибки базы, места в коде. Иначе — сама ошибка, как есть
 */
export function errorForLog(error: unknown): unknown {
  if (!hasQueryError(error)) return error
  return describe(error, 0).join('\n')
}

/**
 * Строка лога без параметров запроса к базе. Better Auth печатает и сам текст ошибки базы
 * («Failed query: …\nparams: …»), а не только её объект: параметры в нём — последняя часть
 */
export function withoutQueryParams(text: string) {
  const at = text.indexOf('\nparams: ')
  return at === -1 ? text : text.slice(0, at)
}
