import { describe, expect, it } from 'vitest'
import { describeApiError } from './api-error'

describe('describeApiError', () => {
  it('раскладывает ошибку проверки по строкам', () => {
    const body = {
      error: {
        code: 'validation',
        message: 'Данные не прошли проверку',
        issues: [{ path: 'title', message: 'Длинно' }],
      },
    }
    expect(describeApiError(400, body)).toBe(
      'API ответил 400: Данные не прошли проверку\n- title: Длинно',
    )
  })

  it('не падает на ответе неизвестного вида', () => {
    expect(describeApiError(502, '<html>Bad Gateway</html>')).toBe('API ответил 502')
  })
})
