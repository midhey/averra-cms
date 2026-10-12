import { describe, expect, it } from 'vitest'
import { ApiRequestError, apiRequestError, messageOf } from './errors'

const response = (status: number, body: unknown) => ({
  status,
  json: async () => body,
})

describe('ошибка из ответа API', () => {
  it('берёт сообщение и ошибки по полям из тела в формате ApiError', async () => {
    const error = await apiRequestError(
      response(409, {
        error: {
          code: 'conflict',
          message: 'Страница с адресом «o-nas» уже есть',
          issues: [{ path: 'slug', message: 'Такой адрес уже есть' }],
        },
      }),
    )
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error.status).toBe(409)
    expect(error.message).toBe('Страница с адресом «o-nas» уже есть')
    expect(error.issues).toEqual([{ path: 'slug', message: 'Такой адрес уже есть' }])
  })

  it('без issues — пустой список, а не undefined', async () => {
    const error = await apiRequestError(
      response(404, { error: { code: 'not_found', message: 'Сайт не найден' } }),
    )
    expect(error.message).toBe('Сайт не найден')
    expect(error.issues).toEqual([])
  })

  it('тело не в формате API (например, прокси отдал HTML) — только статус', async () => {
    const broken = {
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    }
    const error = await apiRequestError(broken)
    expect(error.message).toBe('API ответил 502')
    expect(error.issues).toEqual([])
    expect((await apiRequestError(response(500, { oops: true }))).message).toBe('API ответил 500')
  })

  it('сетевой сбой объясняет, что API не запущен', () => {
    expect(messageOf(new TypeError('Failed to fetch'))).toMatch(/API не отвечает/)
    expect(messageOf(new ApiRequestError(404, 'Сайт не найден'))).toBe('Сайт не найден')
  })
})
