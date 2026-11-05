// @vitest-environment happy-dom
import { NO_SITE_ACCESS_CODE } from '@averra/schema'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../errors'
import { renderWithRouter } from '../test/render-with-router'
import { ErrorScreen } from './StatusScreens'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const noSiteAccess = new ApiRequestError(
  403,
  'Нет доступа к сайту этой установки: попросите владельца пригласить вас',
  [],
  NO_SITE_ACCESS_CODE,
)

describe('экран ошибки', () => {
  it('нет доступа к сайту установки — «Выйти», а не петля «К обзору сайта»', async () => {
    const fetch = vi.fn(async () => Response.json({ success: true }))
    vi.stubGlobal('fetch', fetch)
    const { router } = await renderWithRouter(<ErrorScreen error={noSiteAccess} />)
    expect(screen.getByText(/Нет доступа к сайту этой установки/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'К обзору сайта' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Выйти' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(fetch).toHaveBeenCalledWith('/api/auth/sign-out', expect.anything())
  })

  it('выйти не вышло — причина на экране, кнопка остаётся', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await renderWithRouter(<ErrorScreen error={noSiteAccess} />)
    await userEvent.click(screen.getByRole('button', { name: 'Выйти' }))
    expect(await screen.findByText(/Не вышло выйти: API не отвечает/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeTruthy()
  })

  it('раздел закрыт для роли — «Нет доступа к разделу», а не «Не получилось открыть»', async () => {
    const forbidden = new ApiRequestError(
      403,
      'Заявки видят владелец и администратор сайта',
      [],
      'forbidden',
    )
    await renderWithRouter(<ErrorScreen error={forbidden} />)
    expect(screen.getByRole('heading', { name: 'Нет доступа к разделу' })).toBeTruthy()
    expect(screen.queryByText('Не получилось открыть')).toBeNull()
    expect(screen.getByText('Заявки видят владелец и администратор сайта')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'К обзору сайта' }).getAttribute('href')).toBe('/')
  })

  it('редактору на /notifications: заголовок называет раздел, текст — про уведомления', async () => {
    const forbidden = new ApiRequestError(
      403,
      'Заявки видят владелец и администратор сайта',
      [],
      'forbidden',
    )
    await renderWithRouter(<ErrorScreen error={forbidden} />, '/notifications')
    expect(
      screen.getByRole('heading', { name: 'Нет доступа к разделу «Уведомления»' }),
    ).toBeTruthy()
    expect(screen.getByText('Уведомления настраивают владелец и администратор сайта')).toBeTruthy()
    expect(screen.queryByText('Заявки видят владелец и администратор сайта')).toBeNull()
  })

  it.each([
    [
      '/seo/cookies',
      'Нет доступа к разделу «Cookie и согласие»',
      'Cookie и согласие настраивают владелец и администратор сайта',
    ],
    [
      '/blocks/le-hero',
      'Нет доступа к разделу «Свой блок»',
      'Экран своего блока открывает владелец установки: поля, шаблон и CSS блока пишет студия',
    ],
    ['/seo/redirects', 'Нет доступа к разделу «SEO и аналитика»', 'SEO настраивает владелец'],
    // Своего текста у раздела нет: под заголовком — ответ API как есть (здесь условный)
    ['/tokens', 'Нет доступа к разделу «Доступ для ИИ»', 'SEO настраивает владелец'],
  ])('%s: заголовок называет свой раздел, а не чужой', async (path, heading, text) => {
    const forbidden = new ApiRequestError(403, 'SEO настраивает владелец', [], 'forbidden')
    await renderWithRouter(<ErrorScreen error={forbidden} />, path)
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('сбой остаётся «Не получилось открыть»', async () => {
    await renderWithRouter(<ErrorScreen error={new ApiRequestError(500, 'API ответил 500')} />)
    expect(screen.getByRole('heading', { name: 'Не получилось открыть' })).toBeTruthy()
  })

  it.each([
    ['другая 403', new ApiRequestError(403, 'Нет доступа к сайту', [], 'forbidden')],
    ['сбой в коде', new Error('Cannot read properties of undefined')],
  ])('%s — ссылка «К обзору сайта»', async (_, error) => {
    await renderWithRouter(<ErrorScreen error={error} />)
    expect(screen.getByRole('link', { name: 'К обзору сайта' }).getAttribute('href')).toBe('/')
    expect(screen.queryByRole('button', { name: 'Выйти' })).toBeNull()
  })
})
