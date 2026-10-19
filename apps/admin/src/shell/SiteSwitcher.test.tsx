// @vitest-environment happy-dom
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithRouter } from '../test/render-with-router'
import { SiteSwitcher } from './SiteSwitcher'

afterEach(cleanup)

const first = { id: 'd0000000-0000-4000-8000-000000000001', name: 'Ремонт у Ивана' }
const second = { id: 'd0000000-0000-4000-8000-000000000002', name: 'Студия йоги' }

describe('SiteSwitcher', () => {
  it('переключиться некуда — только название сайта, без кнопки', async () => {
    await renderWithRouter(<SiteSwitcher current={first} sites={[first]} expandable={false} />)
    expect(screen.getByText('Ремонт у Ивана')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('кнопка раскрывает список сайтов, текущий отмечен, Esc закрывает и возвращает фокус', async () => {
    const user = userEvent.setup()
    await renderWithRouter(
      <SiteSwitcher current={first} sites={[first, second]} expandable />,
      `/sites/${first.id}/pages`,
    )
    const button = screen.getByRole('button', { name: /Ремонт у Ивана.*выбрать другой сайт/ })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    await user.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const list = screen.getByRole('list', { name: 'Сайты' })
    expect(button.getAttribute('aria-controls')).toBe(list.id)
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Ремонт у Ивана',
      'Студия йоги',
      'Все сайты',
    ])
    expect(links[0]?.getAttribute('aria-current')).toBe('true')
    expect(links[1]?.getAttribute('aria-current')).toBeNull()
    expect(links[1]?.getAttribute('href')).toBe(`/sites/${second.id}`)

    await user.tab()
    expect(document.activeElement).toBe(links[0])
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('list', { name: 'Сайты' })).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('переход по ссылке закрывает список', async () => {
    const user = userEvent.setup()
    const { router } = await renderWithRouter(
      <SiteSwitcher current={first} sites={[first, second]} expandable />,
    )
    await user.click(screen.getByRole('button'))
    await user.click(screen.getByRole('link', { name: 'Студия йоги' }))
    expect(screen.queryByRole('list', { name: 'Сайты' })).toBeNull()
    expect(router.state.location.pathname).toBe(`/sites/${second.id}`)
  })
})
