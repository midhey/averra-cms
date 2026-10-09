import { z } from 'zod'

/** Формат ошибок API. Его отдают обработчики API, его разбирают админка и MCP */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
})

/** Ошибка API человеческим языком: что не так и в каком поле */
export function describeApiError(status: number, body: unknown) {
  const parsed = ApiError.safeParse(body)
  if (!parsed.success) return `API ответил ${status}`
  const { message, issues = [] } = parsed.data.error
  const lines = issues.map((issue) => `- ${issue.path}: ${issue.message}`)
  return [`API ответил ${status}: ${message}`, ...lines].join('\n')
}
