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

  it('запоздалое close прежнего окна не отвечает «нет» на новый вопрос (Esc и сразу Enter)', async () => {
    const user = userEvent.setup()
    const answers: Record<string, boolean | undefined> = {}
    function Pair() {
      const confirm = useConfirm()
      return (
        <>
          {['первый', 'второй'].map((name) => (
            <button
              key={name}
              type="button"
              onClick={async () => {
                answers[name] = await confirm({ title: `Вопрос ${name}`, confirmLabel: 'Да' })
              }}
            >
              Спросить {name}
            </button>
          ))}
        </>
      )
    }
    render(
      <ConfirmProvider>
        <Pair />
      </ConfirmProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Спросить первый' }))
    const old = screen.getByRole('alertdialog', { name: 'Вопрос первый' })
    // Esc закрыл окно, но его событие close ещё в пути; человек уже задал следующий вопрос
    await user.click(screen.getByRole('button', { name: 'Спросить второй' }))
    expect(answers.первый).toBe(false)
    old.dispatchEvent(new Event('close'))
    // Второй вопрос по-прежнему открыт и без ответа
    expect(screen.getByRole('alertdialog', { name: 'Вопрос второй' })).toBeTruthy()
    expect(answers.второй).toBeUndefined()
    await user.click(screen.getByRole('button', { name: 'Да' }))
    expect(answers.второй).toBe(true)
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
