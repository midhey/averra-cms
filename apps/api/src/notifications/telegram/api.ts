// Bot API Telegram — только то, что нужно уведомлениям: кто бот, отправить сообщение, забрать
// обновления (привязка чата). Здесь типы и ошибка без Node API: их видят маршруты. Реализация на
// undici (прокси HTTP и SOCKS5) — bot-api.ts, её подключают index.ts и testing.ts

import { type ProxyParts, splitProxyUrl } from '@averra/schema'

/** Чат из обновления: личный, группа или супергруппа */
export type TelegramChat = {
  id: number
  type: string
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

/** Обновление getUpdates: нам нужны только сообщения (команда /start с кодом) */
export type TelegramUpdate = {
  update_id: number
  /** date — время сообщения, секунды Unix */
  message?: { message_id: number; date: number; text?: string; chat: TelegramChat }
}

/** Кто бот: getMe */
export type TelegramBot = { id: number; username: string; name: string }

export type TelegramApi = {
  getMe(): Promise<TelegramBot>
  /** Сообщение с разметкой HTML (parse_mode) и без превью ссылок */
  sendMessage(chatId: string, html: string): Promise<{ messageId: string }>
  /** Длинный опрос: ждёт до timeoutSec, пока не придут обновления */
  getUpdates(options: {
    offset?: number
    timeoutSec: number
    signal?: AbortSignal
  }): Promise<TelegramUpdate[]>
  /** Закрыть соединения (прокси) */
  close(): Promise<void>
}

/** Как подключаться: токен бота и прокси (http://, https://, socks5://) или напрямую */
export type TelegramConnection = { token: string; proxy: string | null }

export type TelegramApiFactory = (connection: TelegramConnection) => TelegramApi

/**
 * Почему Bot API не ответил как надо:
 * - network — не дошли до Telegram (сеть, DNS, прокси, тайм-аут);
 * - unauthorized — токен не тот или отозван (401);
 * - forbidden — бота заблокировали или выгнали из группы (403);
 * - bad_request — чат не найден, разметка не разобралась (400);
 * - rate_limited — слишком часто (429), retryAfterMs — сколько ждать;
 * - conflict — у бота webhook или его опрашивает кто-то ещё (409);
 * - server — сбой на стороне Telegram (5xx)
 */
export type TelegramErrorKind =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'bad_request'
  | 'rate_limited'
  | 'conflict'
  | 'server'

/** Ошибка Bot API: текст по-русски и без токена */
export class TelegramApiError extends Error {
  override name = 'TelegramApiError'
  constructor(
    message: string,
    readonly kind: TelegramErrorKind,
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

/** Адрес прокси, который схема и URL читают одинаково: части раскодированы, протокол — для агента */
export type ParsedProxy = ProxyParts & { protocol: string }

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 }

const decodedOrUndefined = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

/**
 * Разобрать адрес прокси так, как его прочтёт undici (через URL), и сверить с разбором схемы.
 * Не совпало (URL увидел другой хост, порт, логин или пароль) или URL его не принял —
 * undefined: через такой прокси не ходим, а человек получает ошибку у поля, а не 500 с адресом
 * в журнале. Схема уже отсекает типичное (# и ? в пароле); это — страховка от того, чего она
 * не знает (например, неверный punycode в имени)
 */
export function parseProxy(proxy: string): ParsedProxy | undefined {
  const own = splitProxyUrl(proxy)
  if ('error' in own || !URL.canParse(proxy)) return undefined
  const url = new URL(proxy)
  const port = url.port ? Number(url.port) : DEFAULT_PORTS[url.protocol]
  // IPv6 URL пишет сжатым ([0:0::1] → [::1]) — сравнивать текстом нечего, важно, что это IPv6
  const sameHost = own.host.startsWith('[')
    ? url.hostname.startsWith('[')
    : url.hostname.toLowerCase() === own.host.toLowerCase()
  const same =
    url.protocol === `${own.scheme}:` &&
    sameHost &&
    port === own.port &&
    decodedOrUndefined(url.username) === own.username &&
    decodedOrUndefined(url.password) === own.password
  return same ? { ...own, protocol: url.protocol } : undefined
}

/** Адрес прокси для людей: без пароля (логин оставляем — по нему узнают, какой это прокси) */
export function proxyForDisplay(proxy: string) {
  const parsed = parseProxy(proxy)
  if (!parsed) {
    // Не разобрался — без логина и пароля вовсе: всё, что до последней «@», может быть секретом
    const scheme = /^[a-z0-9]+:\/\//i.exec(proxy)?.[0] ?? ''
    const rest = proxy.slice(scheme.length)
    return `${scheme}${rest.slice(rest.lastIndexOf('@') + 1)}`
  }
  const url = new URL(proxy)
  url.password = ''
  return url.toString().replace(/\/$/, '')
}
