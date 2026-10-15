import { inspect } from 'node:util'
import { DrizzleQueryError } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { errorForLog } from './log-error'

// В лог сервера не должны попадать параметры запросов к базе и подробности Postgres:
// там бывают секреты (зашифрованный пароль SMTP) и персональные данные

const SECRET = 'v1.0123456789abcdef.AAAA.BBBB.c2VjcmV0'

/** Ошибка базы, как её отдаёт PGlite: сообщение, код и строка целиком в detail */
function databaseError() {
  return Object.assign(
    new Error('new row for relation "mail_settings" violates check constraint "x"'),
    { name: 'error', code: '23514', detail: `Failing row contains (1, ${SECRET})` },
  )
}

const queryError = () =>
  new DrizzleQueryError(
    'insert into "mail_settings" ("password_encrypted") values ($1)',
    [SECRET],
    databaseError(),
  )

/** Как это напечатала бы консоль */
const printed = (value: unknown) =>
  typeof value === 'string' ? value : inspect(value, { depth: 10 })

describe('ошибка для лога', () => {
  it('ошибка запроса к базе — без параметров и без detail, но с запросом, причиной и местом', () => {
    // Без errorForLog значения видны: так печатал app.onError до исправления
    expect(printed(queryError())).toContain(SECRET)

    const text = printed(errorForLog(queryError()))
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('params:')
    expect(text).not.toContain('Failing row')
    expect(text).toContain(
      'Запрос к базе не выполнен: insert into "mail_settings" ("password_encrypted") values ($1)',
    )
    expect(text).toContain(
      'Причина: error: new row for relation "mail_settings" violates check constraint "x" (код 23514)',
    )
    expect(text).toMatch(/\n\s+at /)
  })

  it('ошибка базы глубже в цепочке причин — тоже без значений', () => {
    const wrapped = new Error('Не сохранилось', { cause: queryError() })
    const text = printed(errorForLog(wrapped))
    expect(text).not.toContain(SECRET)
    expect(text).toContain('Error: Не сохранилось')
    expect(text).toContain('Причина: Запрос к базе не выполнен')
  })

  it('остальные ошибки — как есть: в них параметров базы нет', () => {
    const error = new Error('что-то сломалось')
    expect(errorForLog(error)).toBe(error)
    expect(errorForLog('строка')).toBe('строка')
  })
})
