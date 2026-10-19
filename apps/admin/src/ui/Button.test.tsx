// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, IconButton } from './Button'
import { Icon, iconNames } from './Icon'

afterEach(cleanup)

describe('Button', () => {
  it('по умолчанию type="button": случайно форму не отправит', () => {
    render(<Button>Сохранить</Button>)
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveProperty('type', 'button')
  })

  it('отправку формы объявляют явно', () => {
    render(<Button type="submit">Войти</Button>)
    expect(screen.getByRole('button', { name: 'Войти' })).toHaveProperty('type', 'submit')
  })

  it('при загрузке остаётся в фокусе, но нажатие не срабатывает', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <Button loading onClick={onClick}>
        Сохраняю…
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Сохраняю…' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(false)
    await user.tab()
    expect(document.activeElement).toBe(button)
    await user.click(button)
    await user.keyboard('{Enter}')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('загрузка не отправляет форму', async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault())
    const user = userEvent.setup()
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <Button type="submit" loading>
          Отправить
        </Button>
      </form>,
    )
    await user.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('без загрузки нажатие доходит; выключенная — нет', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <>
        <Button onClick={onClick}>Да</Button>
        <Button onClick={onClick} disabled>
          Нет
        </Button>
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Да' }))
    await user.click(screen.getByRole('button', { name: 'Нет' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('IconButton', () => {
  it('подпись — доступное имя и подсказка, иконка скрыта от диктора', () => {
    render(<IconButton label="Закрыть" icon="close" />)
    const button = screen.getByRole('button', { name: 'Закрыть' })
    expect(button.getAttribute('title')).toBe('Закрыть')
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('без подписи не компилируется', () => {
    // @ts-expect-error label обязателен: кнопки-иконки без имени не бывает
    const element = <IconButton icon="close" />
    expect(element).toBeTruthy()
  })
})

describe('Icon', () => {
  it.each(iconNames)('%s — обводка currentColor, без своих цветов, скрыта от диктора', (name) => {
    const { container } = render(<Icon name={name} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.getAttribute('focusable')).toBe('false')
    expect(svg?.getAttribute('fill')).toBe('none')
    expect(svg?.getAttribute('stroke')).toBe('currentColor')
    for (const element of svg?.querySelectorAll('*') ?? []) {
      expect(element.getAttribute('fill') ?? 'none').toBe('none')
      expect(element.getAttribute('stroke') ?? 'currentColor').toBe('currentColor')
    }
  })
})
