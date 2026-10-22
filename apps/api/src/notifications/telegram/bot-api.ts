import { Agent, type Dispatcher, ProxyAgent, request, Socks5ProxyAgent } from 'undici'
import { maskSecrets } from '../../mail/mailer'
import {
  type ParsedProxy,
  parseProxy,
  type TelegramApi,
  TelegramApiError,
  type TelegramApiFactory,
  type TelegramBot,
  type TelegramConnection,
  type TelegramUpdate,
} from './api'

// Bot API Telegram поверх undici: напрямую или через прокси (HTTP/HTTPS — туннелем CONNECT,
// SOCKS5 — Socks5ProxyAgent). С российских VPS api.telegram.org часто
// недоступен напрямую, поэтому сетевая ошибка говорит, что делать. Токен — в адресе запроса,
// поэтому в тексты ошибок он не попадает никогда (maskSecrets). Адреса прокси в текстах ошибок
// тоже нет: их видит и клиент (у ссылки привязки, в сводке заявок), а прокси — дело владельца.
// Socks5ProxyAgent в undici 8 помечен экспериментальным: версия undici закреплена точно, а тесты
// с настоящим SOCKS5-рукопожатием (telegram.test.ts) обязаны проходить при её обновлении

export const TELEGRAM_API_URL = 'https://api.telegram.org'

/** Сколько ждать обычный ответ Bot API */
const REQUEST_TIMEOUT_MS = 15_000

type BotApiOptions = {
  /** Адрес Bot API: свой сервер Bot API, зеркало или фейковый в тестах (TELEGRAM_API_URL) */
  baseUrl?: string
  timeoutMs?: number
}

type Envelope<T> = {
  ok: boolean
  result?: T
  error_code?: number
  description?: string
  parameters?: { retry_after?: number; migrate_to_chat_id?: number }
}

const networkCauses: Record<string, string> = {
  ENOTFOUND: 'имя сервера не найдено (DNS)',
  EAI_AGAIN: 'DNS не ответил',
  ECONNREFUSED: 'соединение отклонено',
  ECONNRESET: 'соединение оборвалось',
  ETIMEDOUT: 'нет ответа (тайм-аут соединения)',
  EHOSTUNREACH: 'сервер недоступен',
  ENETUNREACH: 'сеть недоступна',
  UND_ERR_CONNECT_TIMEOUT: 'нет ответа (тайм-аут соединения)',
  UND_ERR_HEADERS_TIMEOUT: 'сервер не ответил вовремя',
  UND_ERR_BODY_TIMEOUT: 'сервер не ответил вовремя',
  UND_ERR_SOCKET: 'соединение оборвалось',
}

/** Причина сетевой ошибки словами: код ошибки Node или undici, иначе её текст */
function causeOf(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError')
    return 'нет ответа за отведённое время'
  const withCode = (value: unknown) =>
    typeof value === 'object' && value !== null && 'code' in value
      ? String((value as { code: unknown }).code)
      : undefined
  const code = withCode(error) ?? withCode((error as { cause?: unknown })?.cause)
  if (code && networkCauses[code]) return networkCauses[code]
  return error instanceof Error ? error.message : String(error)
}

/**
 * Что вычистить из текста ошибки: пароль прокси (как его видит человек и как он записан в
 * адресе), логин и хост — короткие логин и хост не трогаем, чтобы не испортить весь текст
 */
function proxySecrets(proxy: string, parsed: ParsedProxy | undefined) {
  if (!parsed) return [proxy]
  const url = new URL(proxy)
  const visible = [url.username, parsed.username, url.hostname, parsed.host].filter(
    (part) => part.length >= 3,
  )
  return [url.password, parsed.password, ...visible]
}

/** Адрес прокси не разобрать: undici его не примет. Сам адрес в текст не идёт — в нём пароль */
const unparsedProxy = () =>
  new TelegramApiError(
    'Адрес прокси не разобрать: спецсимволы в логине и пароле запишите %-кодами (# → %23, ? → %3F, @ → %40) и сохраните прокси заново',
    'network',
  )

/**
 * Клиент через прокси. SOCKS5 — своим агентом undici: он сам раскодирует логин и пароль из адреса
 * (%40 → @), а ProxyAgent передал бы их SOCKS-серверу закодированными, и пароль со спецсимволами
 * или логин кириллицей не прошли бы проверку. HTTP(S) — туннелем (CONNECT) и для http:// (свой
 * Bot API без TLS, тесты): прокси видит только CONNECT
 */
export function proxyDispatcher(proxy: string, { protocol }: ParsedProxy): Dispatcher {
  if (protocol === 'socks5:' || protocol === 'socks:') return new Socks5ProxyAgent(proxy)
  return new ProxyAgent({ uri: proxy, proxyTunnel: true })
}

/** Агент подключения; undefined — через этот прокси не пойти (адрес не разобрать) */
function dispatcherFor(proxy: string | null, parsed: ParsedProxy | undefined) {
  if (!proxy) return new Agent()
  if (!parsed) return undefined
  try {
    return proxyDispatcher(proxy, parsed)
  } catch {
    // Конструктор агента бросает с адресом в тексте (а в нём пароль): ошибку не пробрасываем
    return undefined
  }
}

export function botApi({
  baseUrl = TELEGRAM_API_URL,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: BotApiOptions = {}): TelegramApiFactory {
  const host = new URL(baseUrl).host
  return ({ token, proxy }: TelegramConnection): TelegramApi => {
    const parsed = proxy ? parseProxy(proxy) : undefined
    const dispatcher = dispatcherFor(proxy, parsed)
    const secrets = [token, ...(proxy ? proxySecrets(proxy, parsed) : [])]
    const mask = (text: string) => maskSecrets(text, secrets).slice(0, 300)

    function networkError(error: unknown) {
      const cause = mask(causeOf(error))
      return new TelegramApiError(
        proxy
          ? `Не удалось подключиться к Telegram через прокси: ${cause}. Проверьте адрес, порт, логин и пароль прокси в канале Telegram (раздел «Уведомления»)`
          : `Не удалось подключиться к Telegram (${host}): ${cause}. С российских VPS Telegram часто недоступен напрямую — задайте прокси в канале Telegram (раздел «Уведомления»)`,
        'network',
      )
    }

    function apiError(status: number, envelope: Envelope<unknown>) {
      const description = mask(envelope.description ?? `HTTP ${status}`)
      const code = envelope.error_code ?? status
      if (code === 401 || code === 404) {
        return new TelegramApiError(
          `Telegram не принял токен бота (${description}): токен неверный или отозван в @BotFather. Введите новый токен`,
          'unauthorized',
        )
      }
      if (code === 403) {
        return new TelegramApiError(
          `Бот не может писать в этот чат (${description}): его заблокировали или удалили из группы. Привяжите чат заново`,
          'forbidden',
        )
      }
      if (code === 409) {
        return new TelegramApiError(
          `Telegram не отдаёт обновления (${description}): у бота настроен webhook или его опрашивает другая программа. Снимите webhook (deleteWebhook) или остановите её`,
          'conflict',
        )
      }
      if (code === 429) {
        const seconds = envelope.parameters?.retry_after ?? 30
        return new TelegramApiError(
          `Telegram просит подождать ${seconds} с: слишком много сообщений`,
          'rate_limited',
          seconds * 1000,
        )
      }
      if (code >= 500)
        return new TelegramApiError(`Сбой на стороне Telegram (${description})`, 'server')
      if (envelope.parameters?.migrate_to_chat_id) {
        return new TelegramApiError(
          `Группа стала супергруппой и сменила id (${description}): привяжите её заново`,
          'bad_request',
        )
      }
      return new TelegramApiError(`Telegram отклонил запрос (${description})`, 'bad_request')
    }

    async function call<T>(
      method: string,
      params: Record<string, unknown>,
      { wait = timeoutMs, signal }: { wait?: number; signal?: AbortSignal } = {},
    ): Promise<T> {
      if (!dispatcher) throw unparsedProxy()
      const timeout = AbortSignal.timeout(wait)
      let status: number
      let text: string
      try {
        const response = await request(`${baseUrl}/bot${token}/${method}`, {
          method: 'POST',
          dispatcher,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params),
          signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        })
        status = response.statusCode
        text = await response.body.text()
      } catch (error) {
        throw networkError(error)
      }
      let envelope: Envelope<T>
      try {
        envelope = JSON.parse(text) as Envelope<T>
      } catch {
        throw new TelegramApiError(
          `${host} ответил не как Bot API (HTTP ${status}): проверьте TELEGRAM_API_URL и прокси`,
          status >= 500 ? 'server' : 'network',
        )
      }
      if (envelope.ok && envelope.result !== undefined) return envelope.result
      throw apiError(status, envelope)
    }

    return {
      async getMe(): Promise<TelegramBot> {
        const me = await call<{ id: number; username?: string; first_name?: string }>('getMe', {})
        if (!me.username) {
          throw new TelegramApiError(
            'Telegram не вернул имя бота: это точно токен бота?',
            'unauthorized',
          )
        }
        return { id: me.id, username: me.username, name: me.first_name ?? me.username }
      },
      async sendMessage(chatId, html) {
        const message = await call<{ message_id: number }>('sendMessage', {
          chat_id: chatId,
          text: html,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        })
        return { messageId: String(message.message_id) }
      },
      getUpdates({ offset, timeoutSec, signal }) {
        return call<TelegramUpdate[]>(
          'getUpdates',
          {
            ...(offset === undefined ? {} : { offset }),
            timeout: timeoutSec,
            allowed_updates: ['message'],
          },
          { wait: (timeoutSec + 10) * 1000, ...(signal ? { signal } : {}) },
        )
      },
      close: async () => {
        await dispatcher?.close()
      },
    }
  }
}
