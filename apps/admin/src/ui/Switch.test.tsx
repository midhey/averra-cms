// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { SWITCH_STYLE } from './control-style'
import { Switch } from './Switch'
import styles from './Switch.module.scss'

afterEach(cleanup)

describe('Switch', () => {
  it('нативный switch: подпись и Space меняют checked управляемого поля', async () => {
    function Setting() {
      const [checked, setChecked] = useState(false)
      return (
        <Switch
          label="Показывать"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
      )
    }
    const user = userEvent.setup()
    render(<Setting />)
    const input = screen.getByRole('switch', { name: 'Показывать', checked: false })
    expect(input.getAttribute('type')).toBe('checkbox')
    expect(input.hasAttribute('aria-checked')).toBe(false)
    await user.tab()
    expect(document.activeElement).toBe(input)
    await user.keyboard(' ')
    expect(screen.getByRole('switch', { checked: true })).toBe(input)
    await user.click(screen.getByText('Показывать'))
    expect(screen.getByRole('switch', { checked: false })).toBe(input)
  })

  it.each([false, true])('disabled сохраняет состояние %s при клике и Space', async (checked) => {
    const user = userEvent.setup()
    render(<Switch label="Недоступен" disabled defaultChecked={checked} />)
    const input = screen.getByRole('switch') as HTMLInputElement
    await user.click(screen.getByText('Недоступен'))
    await user.tab()
    await user.keyboard(' ')
    expect(document.activeElement).not.toBe(input)
    expect(input.checked).toBe(checked)
  })

  it('склеивает внешнее описание, hint и error и отмечает ошибку', () => {
    render(
      <>
        <p id="outer">Настройка сайта</p>
        <Switch
          label="Индексация"
          aria-describedby="outer"
          hint="Для поисковиков"
          error="Нет доступа"
        />
      </>,
    )
    const input = screen.getByRole('switch')
    const descriptions = input
      .getAttribute('aria-describedby')
      ?.split(' ')
      .map((id) => document.getElementById(id)?.textContent)
    expect(descriptions).toEqual(['Настройка сайта', 'Для поисковиков', 'Нет доступа'])
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('по умолчанию берёт стиль из control-style, variant меняет класс', () => {
    const { rerender } = render(<Switch label="Вид" />)
    const wrapper = () => screen.getByRole('switch').parentElement?.parentElement
    expect(wrapper()?.classList.contains(styles[SWITCH_STYLE] as string)).toBe(true)
    for (const variant of ['minimal', 'icon', 'ios'] as const) {
      rerender(<Switch label="Вид" variant={variant} />)
      expect(wrapper()?.classList.contains(styles[variant] as string)).toBe(true)
    }
  })

  it('передаёт ref и name, участвует в отправке и сбросе формы', async () => {
    const ref = createRef<HTMLInputElement>()
    const user = userEvent.setup()
    render(
      <form aria-label="Настройки">
        <Switch ref={ref} label="Канал" name="channel" defaultChecked />
      </form>,
    )
    const form = screen.getByRole('form') as HTMLFormElement
    expect(ref.current).toBe(screen.getByRole('switch'))
    expect(new FormData(form).get('channel')).toBe('on')
    await user.click(screen.getByText('Канал'))
    expect(new FormData(form).has('channel')).toBe(false)
    form.reset()
    expect(ref.current?.checked).toBe(true)
  })
})
