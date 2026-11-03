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

type Pending = { options: ConfirmOptions; resolve: (answer: boolean) => void }

/**
 * Подтверждения админки — окном @averra/ui вместо системного confirm(): тот выглядит чужим,
 * подписывает кнопки «ОК/Отмена» и на телефоне его можно выключить флажком «Не показывать».
 * Окно одно на всю админку: вопрос задаёт useConfirm(), ответ приходит обещанием
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending>()
  const cancelRef = useRef<HTMLButtonElement>(null)

  const ask = useCallback<Ask>(
    (options) =>
      new Promise((resolve) => {
        // Новый вопрос поверх незакрытого (так не бывает, но если будет) — прежний считается «нет»
        setPending((previous) => {
          previous?.resolve(false)
          return { options, resolve }
        })
      }),
    [],
  )

  const answer = (value: boolean) => {
    pending?.resolve(value)
    setPending(undefined)
  }

  const options = pending?.options
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog
        open={pending !== undefined}
        // Esc, «Закрыть» и клик мимо кнопок — безопасный ответ
        onClose={() => answer(false)}
        title={options?.title ?? ''}
        description={options?.description}
        size="small"
        role="alertdialog"
        initialFocus={cancelRef}
        footer={
          <>
            <Button ref={cancelRef} onClick={() => answer(false)}>
              {options?.cancelLabel ?? 'Отмена'}
            </Button>
            <Button
              variant={options?.tone === 'primary' ? 'primary' : 'danger'}
              onClick={() => answer(true)}
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
