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

/**
 * До API не достучались. fetch сообщает об этом TypeError, но TypeError бывает и от ошибки
 * в коде («Cannot read properties of undefined»): сетевой сбой оборачиваем в свой класс
 * прямо у fetch, чтобы не выдавать любую поломку за «API не отвечает»
 */
export class NetworkError extends Error {
  override name = 'NetworkError'
  constructor(options?: ErrorOptions) {
    super('API не отвечает. Запущен ли pnpm dev?', options)
  }
}

/** fetch для запросов в API: сетевой сбой — NetworkError, остальное как есть */
export const apiFetch: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, init)
  } catch (cause) {
    if (cause instanceof TypeError) throw new NetworkError({ cause })
    throw cause
  }
}

/** Текст для человека из любой ошибки */
export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Что сказать на экране ошибки маршрута. Он ловит и ошибки загрузки, и поломки при отрисовке:
 * ответ API и сетевой сбой объясняем как есть, а ошибку в коде не выдаём за ответ сервера
 */
export function screenErrorOf(error: unknown) {
  if (error instanceof ApiRequestError || error instanceof NetworkError) return error.message
  return `Что-то сломалось в админке. Обновите страницу; если не поможет — это ошибка: ${messageOf(error)}`
}
