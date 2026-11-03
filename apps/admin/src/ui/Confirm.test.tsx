// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfirmProvider, useConfirm } from './Confirm'

afterEach(cleanup)

/** Кнопка, которая спрашивает подтверждение и пишет ответ */
function Asker() {
  const confirm = useConfirm()
  const [answer, setAnswer] = useState('нет ответа')
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const yes = await confirm({
            title: 'Удалить страницу «О нас»?',
            description: 'Вернуть её не получится.',
            confirmLabel: 'Удалить страницу',
            cancelLabel: 'Оставить',
          })
          setAnswer(yes ? 'да' : 'нет')
        }}
      >
        Удалить
      </button>
      <output>{answer}</output>
    </>
  )
}

function setup() {
  const user = userEvent.setup()
  render(
    <ConfirmProvider>
      <Asker />
    </ConfirmProvider>,
  )
  return { user, answer: () => screen.getByRole('status').textContent }
}

describe('подтверждение', () => {
  it('вопрос с описанием, кнопки с глаголами; фокус на безопасной; «Оставить» — нет', async () => {
    const { user, answer } = setup()
    await user.click(screen.getByRole('button', { name: 'Удалить' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Удалить страницу «О нас»?' })
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(dialog.textContent).toContain('Вернуть её не получится.')
    const keep = screen.getByRole('button', { name: 'Оставить' })
    expect(document.activeElement).toBe(keep)
    // Опасное действие — красная кнопка (вариант danger), а не «ОК»
    const remove = screen.getByRole('button', { name: 'Удалить страницу' })
    expect(remove.className).toMatch(/danger/)
    await user.click(keep)
    expect(answer()).toBe('нет')
  })

  it('«Удалить страницу» — да', async () => {
    const { user, answer } = setup()
    await user.click(screen.getByRole('button', { name: 'Удалить' }))
    await user.click(screen.getByRole('button', { name: 'Удалить страницу' }))
    expect(answer()).toBe('да')
  })

  it('«Закрыть» в углу — тоже нет', async () => {
    const { user, answer } = setup()
    await user.click(screen.getByRole('button', { name: 'Удалить' }))
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(answer()).toBe('нет')
  })

  it('без ConfirmProvider — ошибка, а не молчаливое «да»', () => {
    const quiet = console.error
    console.error = () => {}
    try {
      expect(() => render(<Asker />)).toThrow('useConfirm без ConfirmProvider')
    } finally {
      console.error = quiet
    }
  })
})
