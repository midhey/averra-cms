// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SiteHeader, siteDomain } from './SiteHeader'

afterEach(cleanup)

describe('заголовок панели', () => {
  it('название сайта и домен — ссылка на сайт в новой вкладке, выбирать сайт нечего', () => {
    render(<SiteHeader name="Ремонт у Ивана" url="https://remont-ivana.ru" />)
    expect(screen.getByText('Ремонт у Ивана')).toBeTruthy()
    const link = screen.getByRole('link', { name: /remont-ivana\.ru/ })
    expect(link.getAttribute('href')).toBe('https://remont-ivana.ru')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    // Что ссылка уходит в новую вкладку, диктор слышит словами
    expect(link.textContent).toContain('откроется в новой вкладке')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('адрес сайта не задан — только название', () => {
    render(<SiteHeader name="Ремонт у Ивана" url={null} />)
    expect(screen.getByText('Ремонт у Ивана')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('домен — без схемы, но с портом (рендерер pnpm dev)', () => {
    expect(siteDomain('https://example.ru')).toBe('example.ru')
    expect(siteDomain('http://localhost:4321')).toBe('localhost:4321')
  })
})
