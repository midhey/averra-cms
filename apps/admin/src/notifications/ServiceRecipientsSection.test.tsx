// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '../test/render-with-router'
import { ServiceRecipientsSection } from './ServiceRecipientsSection'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('флажок публичных проверок', () => {
  it('сохраняет выбор через API и показывает новое состояние после повторного чтения', async () => {
    let enabled = true
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/service/monitoring')) {
        enabled = (JSON.parse(String(init?.body)) as { enabled: boolean }).enabled
        return Response.json({ enabled })
      }
      return Response.json({
        channels: [],
        recipients: [],
        events: [],
        telegramLock: null,
        monitoringEnabled: enabled,
      })
    })
    vi.stubGlobal('fetch', fetch)
    await renderWithRouter(
      <Suspense fallback="Загрузка">
        <ServiceRecipientsSection />
      </Suspense>,
    )
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Проверять доступность сайта и сертификаты',
    })
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    await userEvent.click(checkbox)
    await waitFor(() => expect((checkbox as HTMLInputElement).checked).toBe(false))
    const call = fetch.mock.calls.find(([url]) => String(url).endsWith('/service/monitoring'))
    expect(call?.[1]?.method).toBe('PUT')
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ enabled: false })
  })

  it('при ошибке показывает причину и сохраняет прежний флажок', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) =>
        String(url).endsWith('/service/monitoring')
          ? Response.json(
              { error: { code: 'internal', message: 'Не удалось сохранить' } },
              { status: 500 },
            )
          : Response.json({
              channels: [],
              recipients: [],
              events: [],
              telegramLock: null,
              monitoringEnabled: true,
            }),
      ),
    )
    await renderWithRouter(
      <Suspense fallback="Загрузка">
        <ServiceRecipientsSection />
      </Suspense>,
    )
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Проверять доступность сайта и сертификаты',
    })
    await userEvent.click(checkbox)
    expect((await screen.findByRole('alert')).textContent).toContain('Не удалось сохранить')
    expect((checkbox as HTMLInputElement).checked).toBe(true)
  })
})
