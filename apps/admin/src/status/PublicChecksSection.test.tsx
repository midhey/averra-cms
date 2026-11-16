// @vitest-environment happy-dom
import type { PublicCheck } from '@averra/schema'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PublicChecksSection } from './PublicChecksSection'

afterEach(cleanup)
const check: PublicCheck = {
  target: 'site',
  checkedAt: '2026-11-16T12:00:00.000Z',
  available: true,
  status: 200,
  failures: 0,
  certificate: { state: 'valid', expiresAt: '2026-12-01T12:00:00.000Z' },
}

describe('доступность и сертификаты в админке', () => {
  it('показывает обе цели, время проверки, HTTP и срок сертификата', () => {
    render(<PublicChecksSection checks={[check, { ...check, target: 'admin' }]} />)
    const section = screen.getByRole('region', { name: 'Доступность и сертификаты' })
    expect(section.textContent).toContain('Сайт')
    expect(section.textContent).toContain('Админка')
    expect(section.textContent).toContain('HTTP 200')
    expect(section.textContent).toContain('Последняя проверка')
    expect(section.textContent).toContain('действителен, срок до')
    expect(section.textContent).toContain('внешний мониторинг')
  })

  it('отличает первый сбой, недоступность и неизвестный сертификат', () => {
    const { rerender } = render(
      <PublicChecksSection
        checks={[
          {
            ...check,
            available: false,
            failures: 1,
            status: null,
            certificate: { state: 'unknown', expiresAt: null },
          },
        ]}
      />,
    )
    expect(screen.getByText(/ждём повторной проверки/)).toBeTruthy()
    expect(screen.getByText(/не удалось проверить/)).toBeTruthy()
    rerender(
      <PublicChecksSection
        checks={[
          {
            ...check,
            available: false,
            failures: 2,
            status: 503,
            certificate: { state: 'invalid', expiresAt: check.checkedAt },
          },
        ]}
      />,
    )
    expect(screen.getByText('не отвечает (HTTP 503)')).toBeTruthy()
    expect(screen.getByText(/истёк или недействителен/)).toBeTruthy()
  })

  it('без проверок объясняет отключение; при выключении сохраняет прошлые данные', () => {
    const { rerender } = render(<PublicChecksSection checks={[]} />)
    expect(screen.getByText(/В разработке и без публичных HTTPS-доменов/)).toBeTruthy()
    rerender(<PublicChecksSection checks={[check]} enabled={false} />)
    expect(screen.getByText(/Проверка выключена в разделе/)).toBeTruthy()
    expect(screen.getByText('отвечает (HTTP 200)')).toBeTruthy()
  })
})
