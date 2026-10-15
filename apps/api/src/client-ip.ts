import type { Http2Bindings, HttpBindings } from '@hono/node-server'
import { isLoopbackHost } from './loopback'

// Что делать с запросом до приложения, зная адрес соединения. Отдельно от index.ts,
// чтобы проверить тестом: index.ts при импорте поднимает сервер и открывает базу

export type ClientIpOptions = {
  /** Перед API стоит свой прокси, который сам ставит X-Forwarded-For */
  trustProxy: boolean
  /** API на учебном секрете: отвечает только на соединения с этого компьютера */
  loopbackOnly: boolean
}

const LOOPBACK_ADDRESS = /^(127(\.\d{1,3}){3}|::1|::ffff:127(\.\d{1,3}){3})$/

export const isLoopbackAddress = (address: string | undefined) =>
  address !== undefined && LOOPBACK_ADDRESS.test(address)

// Адрес запроса @hono/node-server собирает из заголовка Host
const isLoopbackRequest = (request: Request) => isLoopbackHost(new URL(request.url).hostname)

/**
 * Готовит запрос к приложению или сразу отвечает отказом.
 *
 * Лимит попыток входа Better Auth считает по X-Forwarded-For. Без прокси впереди этот
 * заголовок пишет сам клиент и мог бы обходить лимит, меняя «свой» IP на каждой попытке.
 * Поэтому, если прокси не доверяем, ставим в заголовок адрес соединения.
 *
 * Учебный секрет лежит в репозитории. API с ним работает только в учебном режиме — его
 * включает явный флаг --dev (главный замок, см. isLocalDev в config.ts). Здесь добавочная
 * защита: соединения не с этого компьютера такой API не обслуживает. Смотрим на адрес
 * сокета, а не на заголовок: его пишет клиент.
 *
 * Адреса сокета мало, если на том же сервере стоит прокси: он соединяется с API с 127.0.0.1.
 * Поэтому требуем и Host на localhost. Это закрывает прокси, который передаёт настоящий Host
 * (Caddy по умолчанию), и подмену DNS (DNS rebinding): чужая страница, чьё имя вдруг указало
 * на 127.0.0.1, приходит со своим Host. Предел у проверки есть: nginx по умолчанию шлёт
 * апстриму его собственный Host (127.0.0.1:4000), а прокси «для всех имён» передаёт Host
 * клиента как есть, и тот может написать localhost. Такие запросы сюда пройдут, поэтому
 * учебный режим на сервере не включают вовсе
 */
export function prepareRequest(
  request: Request,
  remoteAddress: string | undefined,
  { trustProxy, loopbackOnly }: ClientIpOptions,
): Request | Response {
  if (loopbackOnly && !(isLoopbackAddress(remoteAddress) && isLoopbackRequest(request))) {
    return Response.json(
      {
        error: {
          code: 'forbidden',
          message:
            'API запущен с учебным секретом и отвечает только на запросы к localhost с этого компьютера. ' +
            'Задай свой AUTH_SECRET',
        },
      },
      { status: 403 },
    )
  }
  if (trustProxy) return request
  const headers = new Headers(request.headers)
  headers.set('x-forwarded-for', remoteAddress ?? 'unknown')
  return new Request(request, { headers })
}

type Bindings = HttpBindings | Http2Bindings
type FetchApp = { fetch: (request: Request, env: Bindings) => Response | Promise<Response> }

/** Обработчик для serve из @hono/node-server: prepareRequest перед приложением */
export function serverFetch(app: FetchApp, options: ClientIpOptions) {
  return (request: Request, env: Bindings) => {
    const prepared = prepareRequest(request, env.incoming.socket.remoteAddress, options)
    return prepared instanceof Response ? prepared : app.fetch(prepared, env)
  }
}
