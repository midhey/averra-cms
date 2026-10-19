// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AppShell,
  initialsOf,
  NavLinkContent,
  NavList,
  navLinkClassName,
  SidebarUser,
} from './AppShell'

/**
 * Ширина окна для matchMedia: тесты начинают с телефона, где есть кнопка меню, и могут
 * «расширить окно» до десктопа
 */
let wide = false
const mediaListeners = new Set<(event: { matches: boolean }) => void>()
function setWide(next: boolean) {
  wide = next
  for (const listener of mediaListeners) listener({ matches: next })
}

beforeEach(() => {
  wide = false
  mediaListeners.clear()
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return wide
    },
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) =>
      mediaListeners.add(listener),
    removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) =>
      mediaListeners.delete(listener),
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Shell() {
  return (
    <AppShell
      sidebar={
        <>
          <NavList label="Разделы">
            <li>
              <a className={navLinkClassName} href="#overview" aria-current="page">
                <NavLinkContent icon="overview" label="Обзор" />
              </a>
            </li>
            <li>
              <a className={navLinkClassName} href="#leads">
                <NavLinkContent
                  icon="leads"
                  label="Заявки"
                  badge={{ value: 3, label: 'новых: 3' }}
                />
              </a>
            </li>
          </NavList>
          <SidebarUser name="Алексей Семёнов" roleName="Владелец" />
        </>
      }
    >
      <main>
        <h1>Обзор</h1>
      </main>
    </AppShell>
  )
}

describe('AppShell', () => {
  it('кнопка меню управляет панелью и говорит, открыта ли она', async () => {
    const user = userEvent.setup()
    render(<Shell />)
    const button = screen.getByRole('button', { name: 'Меню' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    const sidebar = document.getElementById(button.getAttribute('aria-controls') ?? '')
    expect(sidebar?.contains(screen.getByRole('navigation', { name: 'Разделы' }))).toBe(true)
    await user.click(button)
    expect(screen.getByRole('button', { name: 'Закрыть меню' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('Esc закрывает меню и возвращает фокус на кнопку', async () => {
    const user = userEvent.setup()
    render(<Shell />)
    await user.click(screen.getByRole('button', { name: 'Меню' }))
    screen.getByRole('link', { name: /Заявки/ }).focus()
    await user.keyboard('{Escape}')
    const button = screen.getByRole('button', { name: 'Меню' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
  })

  it('окно расширили до десктопа — меню закрывается, Esc больше не уводит фокус', async () => {
    const user = userEvent.setup()
    render(<Shell />)
    await user.click(screen.getByRole('button', { name: 'Меню' }))
    const link = screen.getByRole('link', { name: /Заявки/ })
    link.focus()
    act(() => setWide(true))
    expect(screen.getByRole('button', { name: 'Меню' }).getAttribute('aria-expanded')).toBe('false')
    expect(mediaListeners.size).toBe(0)
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(link)
  })

  it('переход по ссылке в меню закрывает его', async () => {
    const user = userEvent.setup()
    render(<Shell />)
    await user.click(screen.getByRole('button', { name: 'Меню' }))
    await user.click(screen.getByRole('link', { name: /Обзор/ }))
    expect(screen.getByRole('button', { name: 'Меню' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('выбор раздела в меню с клавиатуры переводит фокус на содержимое, а не на body', async () => {
    const user = userEvent.setup()
    render(<Shell />)
    await user.click(screen.getByRole('button', { name: 'Меню' }))
    screen.getByRole('link', { name: /Заявки/ }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Меню' }).getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement?.id).toBe('content')
  })

  it('на десктопе (меню закрыто) клик по разделу фокус не трогает', async () => {
    const user = userEvent.setup()
    render(<Shell />)
    const link = screen.getByRole('link', { name: /Заявки/ })
    link.focus()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(link)
  })

  it('счётчик читается с подписью, выбранный раздел отмечен', () => {
    render(<Shell />)
    expect(screen.getByRole('link', { name: /^Заявки\s*,\s*новых: 3$/u })).toBeTruthy()
    expect(screen.getByRole('link', { current: 'page' }).textContent).toBe('Обзор')
    expect(screen.getByText('АС').getAttribute('aria-hidden')).toBe('true')
  })

  it('«Перейти к содержимому» — первая в порядке Tab и переводит фокус на экран', async () => {
    const user = userEvent.setup()
    render(<Shell />)
    await user.tab()
    const skip = screen.getByRole('link', { name: 'Перейти к содержимому' })
    expect(document.activeElement).toBe(skip)
    await user.keyboard('{Enter}')
    expect(document.activeElement?.id).toBe('content')
    expect(document.activeElement?.contains(screen.getByRole('main'))).toBe(true)
  })
})

describe('инициалы', () => {
  it('первые буквы двух слов, скобки и цифры не в счёт', () => {
    expect(initialsOf('Алексей Семёнов')).toBe('АС')
    expect(initialsOf('Владелец (разработка)')).toBe('ВР')
    expect(initialsOf('мария')).toBe('М')
    expect(initialsOf('  42 «Анна»  ')).toBe('А')
  })
})
