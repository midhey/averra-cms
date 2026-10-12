import { ApiError, describeApiError } from '@cms/schema'

type ErrorResponse = { status: number; json(): Promise<unknown> }

/** Текст ошибки из ответа API: что не так и в каком поле */
export async function apiErrorText(res: ErrorResponse) {
  const body = await res.json().catch(() => null)
  return describeApiError(res.status, body)
}

export type ApiIssue = { path: string; message: string }

/** Ошибка из ответа API. Статус и ошибки по полям нужны, чтобы показать их там, где их поправят */
export class ApiRequestError extends Error {
  override name = 'ApiRequestError'

  constructor(
    readonly status: number,
    message: string,
    readonly issues: readonly ApiIssue[] = [],
  ) {
    super(message)
  }
}

/** Ответ API с ошибкой → ApiRequestError. Тело не в формате ApiError — «API ответил N» */
export async function apiRequestError(res: ErrorResponse) {
  const body = await res.json().catch(() => null)
  const parsed = ApiError.safeParse(body)
  if (!parsed.success) return new ApiRequestError(res.status, `API ответил ${res.status}`)
  const { message, issues } = parsed.data.error
  return new ApiRequestError(res.status, message, issues)
}

/** Текст для человека из любой ошибки. Сетевой сбой fetch — это TypeError */
export function messageOf(error: unknown) {
  if (error instanceof TypeError) return 'API не отвечает. Запущен ли pnpm dev?'
  return error instanceof Error ? error.message : String(error)
}
