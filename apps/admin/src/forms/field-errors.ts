import type { z } from 'zod'

/** Ошибки формы по полям: путь ('slug', 'button.href') → первое сообщение */
export type FieldErrors = Readonly<Partial<Record<string, string>>>

type Issue = { readonly path: string; readonly message: string }

/** Ошибки из ответа API (issues). На поле показываем первое сообщение: оно и главное */
export function issueFieldErrors(issues: readonly Issue[]): FieldErrors {
  const errors: Partial<Record<string, string>> = {}
  for (const { path, message } of issues) errors[path] ??= message
  return errors
}

/** Ошибки Zod в том же виде, что и ошибки API: форма разбирает их одинаково */
export function zodFieldErrors(error: z.ZodError | undefined): FieldErrors {
  if (!error) return {}
  return issueFieldErrors(
    error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  )
}

/** Первое поле с ошибкой в порядке полей формы: на него переводим фокус */
export function firstInvalidField(order: readonly string[], errors: FieldErrors) {
  return order.find((name) => errors[name] !== undefined)
}
