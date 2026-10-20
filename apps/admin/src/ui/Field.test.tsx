// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Checkbox, counterText, Select, TextArea, TextInput } from './Field'

afterEach(cleanup)

/** Тексты, на которые ссылается aria-describedby поля */
function descriptionOf(element: HTMLElement) {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent)
}

describe('поля', () => {
  it('подпись связана с полем, подсказка и ошибка — в aria-describedby', () => {
    render(<TextInput label="Почта" hint="На неё придут заявки" error="Неверный адрес" />)
    const input = screen.getByLabelText('Почта')
    expect(input.tagName).toBe('INPUT')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(descriptionOf(input)).toEqual(['На неё придут заявки', 'Неверный адрес'])
  })

  it('свой aria-describedby экрана не теряется, а склеивается с подсказкой и ошибкой', () => {
    render(
      <>
        <p id="outer">Адрес увидят посетители</p>
        <TextInput label="Адрес" aria-describedby="outer" hint="Латиница" error="Занят" />
        <TextArea label="Описание" aria-describedby="outer" />
        <Select label="Роль" aria-describedby="outer" error="Выберите роль">
          <option value="admin">Администратор</option>
        </Select>
        <Checkbox label="Согласие" aria-describedby="outer" hint="Обязательно" />
      </>,
    )
    expect(descriptionOf(screen.getByLabelText('Адрес'))).toEqual([
      'Адрес увидят посетители',
      'Латиница',
      'Занят',
    ])
    expect(descriptionOf(screen.getByLabelText('Описание'))).toEqual(['Адрес увидят посетители'])
    expect(descriptionOf(screen.getByLabelText('Роль'))).toEqual([
      'Адрес увидят посетители',
      'Выберите роль',
    ])
    expect(descriptionOf(screen.getByLabelText('Согласие'))).toEqual([
      'Адрес увидят посетители',
      'Обязательно',
    ])
  })

  it('без ошибки нет aria-invalid и пустого aria-describedby', () => {
    render(<TextInput label="Имя" />)
    const input = screen.getByLabelText('Имя')
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    expect(input.hasAttribute('aria-describedby')).toBe(false)
    expect(input.getAttribute('autocomplete')).toBe('off')
  })

  it('скрытая подпись остаётся доступным именем', () => {
    render(<TextInput label="Найти страницу" hideLabel type="search" />)
    expect(screen.getByRole('searchbox', { name: 'Найти страницу' })).toBeTruthy()
  })

  it('иконка слева — только рисунок: скрыта от диктора, имя поля — подпись', () => {
    const { container } = render(
      <TextInput label="Найти страницу" hideLabel type="search" icon="search" />,
    )
    expect(screen.getByRole('searchbox', { name: 'Найти страницу' })).toBeTruthy()
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.nextElementSibling?.tagName).toBe('INPUT')
  })

  it('приставка видна, но не входит в имя поля', () => {
    render(<TextInput label="Адрес" prefix="/" />)
    expect(screen.getByRole('textbox', { name: 'Адрес' })).toBeTruthy()
    expect(screen.getByText('/').getAttribute('aria-hidden')).toBe('true')
  })

  it('счётчик символов считает ввод и не обрезает длинный текст', async () => {
    function Title() {
      const [value, setValue] = useState('Ремонт')
      return (
        <TextArea
          label="Заголовок"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxChars={10}
          hint="станет h1 страницы"
        />
      )
    }
    const user = userEvent.setup()
    render(<Title />)
    const textarea = screen.getByLabelText('Заголовок')
    expect(descriptionOf(textarea)).toEqual(['станет h1 страницы', '6 из 10 символов'])
    expect(textarea.hasAttribute('maxlength')).toBe(false)
    await user.type(textarea, ' квартир')
    expect((textarea as HTMLTextAreaElement).value).toBe('Ремонт квартир')
    expect(descriptionOf(textarea)).toContain('14 из 10 символов')
    expect(textarea.getAttribute('aria-invalid')).toBe('true')
  })

  it('«из 21 символа», «из 120 символов»', () => {
    expect(counterText(3, 21)).toBe('3 из 21 символа')
    expect(counterText(3, 11)).toBe('3 из 11 символов')
    expect(counterText(49, 120)).toBe('49 из 120 символов')
  })

  it('выпадающий список подписан и выбирается', async () => {
    const user = userEvent.setup()
    render(
      <Select label="Роль" defaultValue="client">
        <option value="client">Клиент</option>
        <option value="editor">Редактор</option>
      </Select>,
    )
    const select = screen.getByRole('combobox', { name: 'Роль' })
    await user.selectOptions(select, 'editor')
    expect((select as HTMLSelectElement).value).toBe('editor')
  })
})

describe('Checkbox', () => {
  it('нажимается по подписи, подсказка и ошибка связаны', async () => {
    const user = userEvent.setup()
    render(<Checkbox label="Согласие" hint="Без него форма не уйдёт" error="Отметьте флажок" />)
    const checkbox = screen.getByRole('checkbox', { name: 'Согласие' })
    await user.click(screen.getByText('Согласие'))
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    expect(checkbox.getAttribute('aria-invalid')).toBe('true')
    expect(descriptionOf(checkbox)).toEqual(['Без него форма не уйдёт', 'Отметьте флажок'])
  })

  it('с клавиатуры — пробелом', async () => {
    const user = userEvent.setup()
    render(<Checkbox label="Флажок" />)
    await user.tab()
    await user.keyboard(' ')
    expect((screen.getByRole('checkbox', { name: 'Флажок' }) as HTMLInputElement).checked).toBe(
      true,
    )
  })
})
