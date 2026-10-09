import { describeApiError } from '@cms/schema'

/** Текст ошибки из ответа API: что не так и в каком поле */
export async function apiErrorText(res: { status: number; json(): Promise<unknown> }) {
  const body = await res.json().catch(() => null)
  return describeApiError(res.status, body)
}

/** Текст для человека из любой ошибки. Сетевой сбой fetch — это TypeError */
export function messageOf(error: unknown) {
  if (error instanceof TypeError) return 'API не отвечает. Запущен ли pnpm dev?'
  return error instanceof Error ? error.message : String(error)
}
