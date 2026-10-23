// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddBlockDialog } from './AddBlockDialog'
import { catalog } from './catalog'

afterEach(cleanup)

function open(after: string | null = null) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(<AddBlockDialog open onClose={onClose} onPick={onPick} after={after} />)
  const dialog = screen.getByRole('dialog', { name: 'Добавить блок' })
  const cards = () =>
    within(within(dialog).getByRole('list', { name: 'Каталог блоков' })).getAllByRole('button')
  return { dialog, cards, onPick, onClose }
}

describe('AddBlockDialog', () => {
  it('карточка: набросок для зрячих, название, описание, у новых — пометка', () => {
    const { dialog, cards } = open('Почему мы')
    expect(dialog.textContent).toContain('Блок встанет после «Почему мы».')
    expect(cards()).toHaveLength(catalog.length)
    const pricing = within(dialog).getByRole('button', { name: /^Услуги и цены/ })
    expect(pricing.textContent).toContain('новый')
    expect(pricing.textContent).toContain('Тарифы карточками')
    expect(pricing.querySelector('[aria-hidden="true"]')?.childElementCount).toBe(3)
    expect(within(dialog).getByRole('button', { name: /^Первый экран/ }).textContent).not.toContain(
      'новый',
    )
  })

  it('разделы — радиокнопки: «Все» с числом блоков, выбор раздела фильтрует', async () => {
    const user = userEvent.setup()
    const { dialog, cards } = open()
    const sections = within(dialog).getByRole('group', { name: 'Раздел каталога' })
    const all = within(sections).getByRole('radio', { name: `Все · ${catalog.length}` })
    expect((all as HTMLInputElement).checked).toBe(true)

    await user.click(within(sections).getByRole('radio', { name: 'Продажа' }))
    expect(cards()).toHaveLength(3)
    expect(within(dialog).getByRole('status').textContent).toBe('Найдено: 3 блока')
    expect(within(dialog).getByRole('button', { name: /^Как мы работаем/ })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /^Первый экран/ })).toBeNull()
  })

  it('поиск по названию и описанию; ничего не нашлось — «Показать все блоки»', async () => {
    const user = userEvent.setup()
    const { dialog, cards } = open()
    const search = within(dialog).getByRole('searchbox', { name: 'Найти блок' })
    await user.type(search, 'вопрос')
    expect(cards()).toHaveLength(1)
    expect(within(dialog).getByRole('status').textContent).toBe('Найдено: 1 блок')

    await user.clear(search)
    await user.type(search, 'слайдер')
    expect(within(dialog).queryByRole('list', { name: 'Каталог блоков' })).toBeNull()
    expect(within(dialog).getByRole('heading', { name: 'Такого блока нет' })).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Показать все блоки' }))
    expect(cards()).toHaveLength(catalog.length)
    expect((search as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(search)
  })

  it('выбор — кнопкой, с клавиатуры Enter', async () => {
    const user = userEvent.setup()
    const { dialog, onPick } = open()
    within(dialog)
      .getByRole('button', { name: /^Вопросы и ответы/ })
      .focus()
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith('faq')
  })
})
