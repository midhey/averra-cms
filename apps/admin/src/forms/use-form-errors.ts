import { useState } from 'react'
import type { FieldErrors } from './field-errors'

/**
 * Ошибки формы из двух источников: схема в браузере и ответ API (например, «такой адрес уже
 * есть»). Ошибки схемы видны только после первой попытки отправить, чтобы не ругаться на
 * пустую форму, а дальше обновляются при вводе. Ошибка от API живёт, пока поле не поправят
 */
export function useFormErrors(schemaErrors: FieldErrors) {
  const [attempted, setAttempted] = useState(false)
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})

  return {
    errors: { ...serverErrors, ...(attempted ? schemaErrors : {}) } as FieldErrors,
    attempt: () => setAttempted(true),
    showServerErrors: setServerErrors,
    clearServerError: (name: string) =>
      setServerErrors((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== name)),
      ),
  }
}

/** Фокус на поле формы по имени: человек с клавиатуры сразу попадает туда, где ошибка */
export function focusField(form: HTMLFormElement | null, name: string | undefined) {
  if (!form || name === undefined) return
  const field = form.elements.namedItem(name)
  if (field instanceof HTMLElement) field.focus()
}
