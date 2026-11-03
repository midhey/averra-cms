import { NO_SITE_ACCESS_CODE } from '@averra/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSectionForbidden, reportCaughtError } from './caught-error'
import { ApiRequestError } from './errors'

afterEach(() => vi.restoreAllMocks())

describe('ошибка, пойманная границей маршрута', () => {
  it('отказ 403 при загрузке раздела — не сбой, в консоль не пишем', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const forbidden = new ApiRequestError(403, 'Заявки видят владелец', [], 'forbidden')
    expect(isSectionForbidden(forbidden)).toBe(true)
    reportCaughtError(forbidden, { componentStack: '' })
    expect(log).not.toHaveBeenCalled()
  })

  it.each([
    ['нет доступа к сайту целиком', new ApiRequestError(403, 'Нет сайта', [], NO_SITE_ACCESS_CODE)],
    ['сбой API', new ApiRequestError(500, 'API ответил 500')],
    ['сбой в коде', new Error('Cannot read properties of undefined')],
  ])('%s — настоящий сбой, в консоль пишем', (_, error) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(isSectionForbidden(error)).toBe(false)
    reportCaughtError(error, { componentStack: '\n  at Screen' })
    expect(log).toHaveBeenCalledWith('Экран упал:', error, '\n  at Screen')
  })
})
