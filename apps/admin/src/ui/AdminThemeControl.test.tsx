// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminThemeControl } from './AdminThemeControl'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('переключатель темы админки', () => {
  it('показывает ранний выбор и синхронизирует переключатели', async () => {
    document.documentElement.dataset.theme = 'dark'
    const user = userEvent.setup()
    render(
      <>
        <AdminThemeControl />
        <AdminThemeControl />
      </>,
    )
    for (const input of screen.getAllByRole('radio', { name: 'Тёмная' })) {
      expect((input as HTMLInputElement).checked).toBe(true)
    }
    await user.click(screen.getAllByRole('radio', { name: 'Как в системе' })[0] as HTMLElement)
    expect(document.documentElement.dataset.theme).toBe('system')
    expect(localStorage.getItem('averra-admin-theme')).toBe('system')
    for (const input of screen.getAllByRole('radio', { name: 'Как в системе' })) {
      expect((input as HTMLInputElement).checked).toBe(true)
    }
  })

  it('применяет тему, даже если запись в хранилище запрещена', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Хранилище заполнено')
    })
    const user = userEvent.setup()
    render(<AdminThemeControl />)
    await user.click(screen.getByRole('radio', { name: 'Тёмная' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect((screen.getByRole('radio', { name: 'Тёмная' }) as HTMLInputElement).checked).toBe(true)
  })
})
