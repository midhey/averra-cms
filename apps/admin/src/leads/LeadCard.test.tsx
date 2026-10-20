// @vitest-environment happy-dom
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '../test/render-with-router'
import { LeadCard } from './LeadCard'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const site = { id: 'd0000000-0000-4000-8000-000000000001', name: 'Ремонт у Ивана' }

const lead = (email: string) => ({
  id: 'a0000000-0000-4000-8000-000000000001',
  pageSlug: 'index',
  formTitle: 'Замер',
  data: [
    { name: 'name', label: 'Имя', type: 'name', value: 'Мария' },
    { name: 'email', label: 'Почта', type: 'email', value: email },
  ],
  consentText: 'Я согласен на обработку персональных данных',
  consentPolicyUrl: '/privacy',
  pageVersion: 12,
  consentedAt: '2026-10-19T08:42:00.000Z',
  status: 'new' as const,
  processedAt: null,
  createdAt: '2026-10-19T08:42:00.000Z',
})

describe('LeadCard', () => {
  it('имя — заголовок карточки, поля списком, «Ответить письмом» — mailto с адресом посетителя', async () => {
    await renderWithRouter(
      <LeadCard
        site={site}
        lead={lead('maria@example.ru')}
        pageTitle="Главная"
        status={undefined}
      />,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Мария' })).toBeTruthy()
    expect(screen.getByRole('article', { name: 'Мария' })).toBeTruthy()
    expect(screen.getByText('maria@example.ru')).toBeTruthy()
    const reply = screen.getByRole('link', { name: 'Ответить письмом' })
    expect(reply.getAttribute('href')).toMatch(/^mailto:maria@example\.ru\?subject=/)
    expect(screen.getByRole('button', { name: 'Отметить обработанной' })).toBeTruthy()
  })

  it('без почты посетителя «Ответить письмом» нет', async () => {
    await renderWithRouter(<LeadCard site={site} lead={lead('')} status={undefined} />)
    expect(screen.queryByRole('link', { name: 'Ответить письмом' })).toBeNull()
  })

  it('удаление — только после подтверждения', async () => {
    const user = userEvent.setup()
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const onDeleted = vi.fn()
    const { router } = await renderWithRouter(
      <LeadCard site={site} lead={lead('')} status="new" onDeleted={onDeleted} />,
      `/sites/${site.id}/leads/a0000000-0000-4000-8000-000000000001`,
    )

    await user.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Удалить заявку «Мария»'))
    expect(fetch).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Удалить' }))
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalled())
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toContain(
      `/api/sites/${site.id}/leads/a0000000-0000-4000-8000-000000000001`,
    )
    expect(init.method).toBe('DELETE')
    // Вернулись к списку на ту же вкладку
    expect(router.state.location.pathname).toBe(`/sites/${site.id}/leads`)
    expect(router.state.location.search).toEqual({ status: 'new' })
  })

  it('обработанная заявка — дата обработки видна в строке сведений, а не только диктору', async () => {
    const processed = {
      ...lead(''),
      status: 'processed' as const,
      processedAt: '2026-10-20T09:15:00.000Z',
    }
    await renderWithRouter(<LeadCard site={site} lead={processed} status={undefined} />)
    const when = document.querySelector('time[datetime="2026-10-20T09:15:00.000Z"]')
    expect(when).toBeTruthy()
    const line = when?.closest('p')
    expect(line?.textContent).toMatch(/^Обработана /)
    expect(line?.closest('.visually-hidden')).toBeNull()
    expect(line?.className).not.toContain('visually-hidden')
  })

  it('телефон и почта в полях — ссылки tel: и mailto:', async () => {
    const withPhone = {
      ...lead('maria@example.ru'),
      data: [
        ...lead('maria@example.ru').data,
        { name: 'phone', label: 'Телефон', type: 'phone', value: '+7 (912) 000-00-00' },
      ],
    }
    await renderWithRouter(<LeadCard site={site} lead={withPhone} status={undefined} />)
    const fields = document.querySelector<HTMLElement>(
      'dl[aria-label="Поля заявки"]',
    ) as HTMLElement
    expect(
      within(fields).getByRole('link', { name: '+7 (912) 000-00-00' }).getAttribute('href'),
    ).toBe('tel:+79120000000')
    expect(
      within(fields).getByRole('link', { name: 'maria@example.ru' }).getAttribute('href'),
    ).toBe('mailto:maria@example.ru')
    expect(within(fields).queryByRole('link', { name: 'Мария' })).toBeNull()
  })
})
