// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../errors'
import { PublishOutcome } from './PublishOutcome'
import { publishPages, publishQuestion } from './publish-all'

afterEach(cleanup)

/** Ответ API: 200 — опубликована, иначе ошибка в формате ApiError */
const reply = (status: number, message = '') => ({
  status,
  json: async () => (status === 200 ? {} : { error: { code: 'x', message } }),
})

describe('«Опубликовать правки»: по очереди, сбой одной не останавливает остальные', () => {
  const targets = [
    { slug: 'index', title: 'Главная' },
    { slug: 'ceny', title: 'Цены' },
    // Тот же заголовок у другой страницы: итог различает их по адресу
    { slug: 'ceny-2', title: 'Цены' },
  ]

  it('одна вышла, две нет: итог называет какие и почему', async () => {
    const publishOne = vi.fn(async (slug: string) =>
      slug === 'index' ? reply(200) : reply(409, `Страница ${slug} занята`),
    )
    const result = await publishPages(targets, publishOne)
    expect(publishOne.mock.calls.map(([slug]) => slug)).toEqual(['index', 'ceny', 'ceny-2'])
    expect(result).toEqual({
      published: 1,
      failed: [
        { slug: 'ceny', title: 'Цены', message: 'Страница ceny занята' },
        { slug: 'ceny-2', title: 'Цены', message: 'Страница ceny-2 занята' },
      ],
    })

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<PublishOutcome result={result} error={null} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Не все правки опубликованы')
    expect(alert.textContent).toContain('Опубликовано: 1 страница')
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '«Цены»: Страница ceny занята',
      '«Цены»: Страница ceny-2 занята',
    ])
    // Одинаковые заголовки не дают React повторяющихся ключей
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('кончилась сессия — дальше не публикует, ошибка 401 уходит наверх (там — вход)', async () => {
    const publishOne = vi.fn(async (slug: string) =>
      slug === 'index' ? reply(401, 'Войдите заново') : reply(200),
    )
    const failure = await publishPages(targets, publishOne).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiRequestError)
    expect((failure as ApiRequestError).status).toBe(401)
    expect(publishOne).toHaveBeenCalledTimes(1)
  })

  it('всё вышло — спокойное «опубликованы», без списка', async () => {
    const result = await publishPages(targets.slice(0, 2), async () => reply(200))
    render(<PublishOutcome result={result} error={null} />)
    expect(screen.getByRole('status').textContent).toBe(
      'Правки опубликованы: 2 страницы. Сайт обновится после сборки.',
    )
  })

  it('вопрос перед публикацией перечисляет страницы, длинный список — с «и ещё»', () => {
    expect(publishQuestion(targets.slice(0, 2))).toBe(
      'Опубликовать правки на сайте: «Главная», «Цены»? Сайт обновится после сборки.',
    )
    const many = Array.from({ length: 7 }, (_, index) => ({
      slug: `p${index}`,
      title: `П${index}`,
    }))
    expect(publishQuestion(many)).toBe(
      'Опубликовать правки на сайте: «П0», «П1», «П2», «П3», «П4» и ещё 2 страницы? Сайт обновится после сборки.',
    )
  })
})
