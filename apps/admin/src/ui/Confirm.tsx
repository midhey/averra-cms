import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

export type ConfirmOptions = {
  /** Вопрос целиком: «Удалить страницу «О нас»?» */
  title: string
  /** Что будет после ответа «да»: «Её не вернуть» */
  description?: ReactNode
  /** Глагол на кнопке: «Удалить», «Уйти без сохранения» — не «ОК» */
  confirmLabel: string
  /** Безопасный ответ: «Оставить», «Остаться». По умолчанию — «Отмена» */
  cancelLabel?: string
  /** danger — действие не вернуть (удалить, отозвать): кнопка красная */
  tone?: 'danger' | 'primary'
}

type Ask = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Ask | undefined>(undefined)

type Pending = { id: number; options: ConfirmOptions; resolve: (answer: boolean) => void }

/**
 * Подтверждения админки — окном @averra/ui вместо системного confirm(): тот выглядит чужим,
 * подписывает кнопки «ОК/Отмена» и на телефоне его можно выключить флажком «Не показывать».
 * Окно одно на всю админку: вопрос задаёт useConfirm(), ответ приходит обещанием
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending>()
  const cancelRef = useRef<HTMLButtonElement>(null)
  // Номер вопроса: у каждого вопроса своё окно (key), а ответ привязан к своему вопросу
  const lastId = useRef(0)
  const shownId = useRef(0)

  const ask = useCallback<Ask>(
    (options) =>
      new Promise((resolve) => {
        // Новый вопрос поверх незакрытого (так не бывает, но если будет) — прежний считается «нет»
        setPending((previous) => {
          previous?.resolve(false)
          lastId.current += 1
          return { id: lastId.current, options, resolve }
        })
      }),
    [],
  )

  // Ответ — на тот вопрос, который окно показывало. Событие close приходит отдельной задачей,
  // через несколько миллисекунд после Esc: если за это время задан новый вопрос, запоздалое
  // событие прежнего окна не должно ответить «нет» уже на новый (setPending ниже трогает только
  // свой вопрос, а resolve повторно ничего не меняет)
  const settle = (question: Pending, value: boolean) => {
    question.resolve(value)
    setPending((current) => (current === question ? undefined : current))
  }
  if (pending) shownId.current = pending.id

  const options = pending?.options
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog
        // Новый вопрос — новое окно: прежнее, закрытое Esc, не показалось бы заново (open не менялся)
        key={shownId.current}
        open={pending !== undefined}
        // Esc, «Закрыть» и клик мимо кнопок — безопасный ответ
        onClose={() => pending && settle(pending, false)}
        title={options?.title ?? ''}
        description={options?.description}
        size="small"
        role="alertdialog"
        initialFocus={cancelRef}
        footer={
          <>
            <Button ref={cancelRef} onClick={() => pending && settle(pending, false)}>
              {options?.cancelLabel ?? 'Отмена'}
            </Button>
            <Button
              variant={options?.tone === 'primary' ? 'primary' : 'danger'}
              onClick={() => pending && settle(pending, true)}
            >
              {options?.confirmLabel}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  )
}

/**
 * Спросить подтверждение: `if (!(await confirm({ … }))) return`. Без ConfirmProvider (тесты
 * отдельных компонентов) — ошибка: молча соглашаться на удаление нельзя
 */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext)
  if (!ask) throw new Error('useConfirm без ConfirmProvider')
  return ask
}
