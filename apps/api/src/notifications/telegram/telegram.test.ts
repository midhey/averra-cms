import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { connect, createServer as createTcpServer, type Socket } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { ChannelSendError } from '../channel'
import { sendErrorOf } from '../channels/telegram'
import { startFakeTelegram } from '../testing/fake-telegram'
import { TEST_BOT_TOKEN } from '../testing/scenario'
import { proxyForDisplay, type TelegramApiError } from './api'
import { botApi } from './bot-api'
import { escapeTelegramHtml, fitValues, TELEGRAM_TEXT_LIMIT, telegramText } from './format'

// Telegram-адаптер против локального фейкового Bot API: тот же протокол, что у api.telegram.org,
// без сети. Прокси — свой маленький HTTP-прокси с CONNECT: так же ходит ProxyAgent к настоящему

const fake = await startFakeTelegram({ token: TEST_BOT_TOKEN, pollWaitMs: 50 })
afterAll(() => fake.close())

const connect_ = (proxy: string | null = null, token = TEST_BOT_TOKEN) =>
  botApi({ baseUrl: fake.url, timeoutMs: 3000 })({ token, proxy })

/** HTTP-прокси с CONNECT и, если задан, логином: считает туннели */
async function startConnectProxy(credentials?: string) {
  let tunnels = 0
  const server: Server = createServer((_, response) => {
    response.writeHead(405)
    response.end()
  })
  server.on('connect', (request, socket, head) => {
    const auth = request.headers['proxy-authorization']
    if (credentials && auth !== `Basic ${Buffer.from(credentials).toString('base64')}`) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n')
      return
    }
    tunnels += 1
    const [host, port] = (request.url ?? '').split(':')
    const upstream = connect(Number(port), host ?? '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    tunnels: () => tunnels,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/**
 * SOCKS5-прокси (RFC 1928) с логином и паролем (RFC 1929): только CONNECT, адрес — IPv4 или
 * имя. Ровно то, что делает ProxyAgent undici с адресом socks5://; считает туннели
 */
async function startSocksProxy(user: string, password: string) {
  let tunnels = 0
  // Сбой соединения закрывает сокет (обработчик ниже): незаконченное чтение просто не дождётся
  const read = (socket: Socket, size: number) =>
    new Promise<Buffer>((resolve) => {
      const tryRead = () => {
        const chunk = socket.read(size) as Buffer | null
        if (chunk) resolve(chunk)
        else socket.once('readable', tryRead)
      }
      tryRead()
    })
  const server = createTcpServer((socket) => {
    socket.on('error', () => socket.destroy())
    void (async () => {
      const [, methods = 0] = await read(socket, 2)
      const offered = await read(socket, methods)
      if (!offered.includes(2)) {
        socket.end(Buffer.from([5, 0xff]))
        return
      }
      socket.write(Buffer.from([5, 2]))
      const [, userLength = 0] = await read(socket, 2)
      const name = (await read(socket, userLength)).toString()
      const [passLength = 0] = await read(socket, 1)
      const pass = (await read(socket, passLength)).toString()
      if (name !== user || pass !== password) {
        socket.end(Buffer.from([1, 1]))
        return
      }
      socket.write(Buffer.from([1, 0]))
      const [, command, , addressType] = await read(socket, 4)
      let host: string
      if (addressType === 1) host = [...(await read(socket, 4))].join('.')
      else {
        const [length = 0] = await read(socket, 1)
        host = (await read(socket, length)).toString()
      }
      const port = (await read(socket, 2)).readUInt16BE(0)
      if (command !== 1) {
        socket.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]))
        return
      }
      const upstream = connect(port, host, () => {
        tunnels += 1
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
        upstream.pipe(socket)
        socket.pipe(upstream)
      })
      upstream.on('error', () => socket.destroy())
      socket.on('close', () => upstream.destroy())
    })().catch(() => socket.destroy())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const sockets = new Set<Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  return {
    port: (server.address() as AddressInfo).port,
    tunnels: () => tunnels,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}

describe('Bot API', () => {
  it('getMe и sendMessage: HTML-разметка, без превью ссылок', async () => {
    const api = connect_()
    try {
      expect(await api.getMe()).toEqual({
        id: 7000001,
        username: 'averra_test_bot',
        name: 'Averra Test',
      })
      const sent = await api.sendMessage('123', '<b>Привет</b>')
      expect(sent.messageId).toMatch(/^\d+$/)
      expect(fake.messagesTo('123').at(-1)).toEqual({
        chatId: '123',
        text: '<b>Привет</b>',
        parseMode: 'HTML',
      })
    } finally {
      await api.close()
    }
  })

  it('ошибки Bot API — по-русски, без токена, с видом: что делать очереди', async () => {
    const api = connect_()
    const errorOf = async (run: () => Promise<unknown>) => {
      try {
        await run()
      } catch (error) {
        return error as TelegramApiError
      }
      throw new Error('ожидалась ошибка')
    }
    try {
      fake.failNext({ status: 403, description: 'Forbidden: bot was blocked by the user' })
      const blocked = await errorOf(() => api.sendMessage('1', 'x'))
      expect(blocked.kind).toBe('forbidden')
      expect(sendErrorOf(blocked).kind).toBe('permanent')

      fake.failNext({ status: 429, description: 'Too Many Requests', retryAfter: 7 })
      const limited = await errorOf(() => api.sendMessage('1', 'x'))
      expect(limited).toMatchObject({ kind: 'rate_limited', retryAfterMs: 7000 })
      expect(sendErrorOf(limited)).toMatchObject({ kind: 'retry', retryAfterMs: 7000 })

      fake.failNext({
        status: 400,
        description: 'Bad Request: group chat was upgraded',
        migrateTo: -1001,
      })
      const migrated = await errorOf(() => api.sendMessage('1', 'x'))
      expect(migrated.message).toContain('супергруппой')

      fake.failNext({ status: 500, description: 'Internal Server Error' })
      expect(sendErrorOf(await errorOf(() => api.sendMessage('1', 'x'))).kind).toBe('retry')
    } finally {
      await api.close()
    }
    const wrong = connect_(null, '7000001:AAWrongTokenWrongTokenWrongToken12345')
    try {
      const error = await errorOf(() => wrong.getMe())
      expect(error.kind).toBe('unauthorized')
      expect(error.message).toContain('не принял токен')
      expect(error.message).not.toContain('AAWrongToken')
      expect(sendErrorOf(error)).toBeInstanceOf(ChannelSendError)
      expect(sendErrorOf(error).kind).toBe('channel')
    } finally {
      await wrong.close()
    }
  })

  it('сеть недоступна — канал целиком, совет про прокси', async () => {
    const api = botApi({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 3000 })({
      token: TEST_BOT_TOKEN,
      proxy: null,
    })
    try {
      await expect(api.getMe()).rejects.toMatchObject({
        kind: 'network',
        message: expect.stringContaining('задайте прокси'),
      })
    } finally {
      await api.close()
    }
  })

  it('через HTTP-прокси с логином: туннель CONNECT, пароль прокси не попадает в ошибки', async () => {
    const proxy = await startConnectProxy('averra:proxy-pass')
    const withLogin = proxy.url.replace('http://', 'http://averra:proxy-pass@')
    const api = connect_(withLogin)
    const denied = connect_(proxy.url.replace('http://', 'http://averra:wrong-pass@'))
    try {
      expect((await api.getMe()).username).toBe('averra_test_bot')
      expect(proxy.tunnels()).toBeGreaterThan(0)
      const error = await denied.getMe().catch((caught: TelegramApiError) => caught)
      expect(error).toMatchObject({ kind: 'network' })
      // Адреса прокси в тексте нет: его видит и клиент (у ссылки привязки, в сводке заявок)
      expect((error as Error).message).toContain('через прокси:')
      for (const part of ['wrong-pass', 'averra', '127.0.0.1', new URL(proxy.url).port]) {
        expect((error as Error).message).not.toContain(part)
      }
    } finally {
      await api.close()
      await denied.close()
      await proxy.close()
    }
  })

  it('через SOCKS5 с логином: getMe и sendMessage идут туннелем, пароль не в ошибках', async () => {
    const proxy = await startSocksProxy('averra', 'socks-pass')
    const api = connect_(`socks5://averra:socks-pass@127.0.0.1:${proxy.port}`)
    const denied = connect_(`socks5://averra:wrong-pass@127.0.0.1:${proxy.port}`)
    try {
      expect((await api.getMe()).username).toBe('averra_test_bot')
      await api.sendMessage('31337', 'через SOCKS5')
      expect(fake.messagesTo('31337').at(-1)?.text).toBe('через SOCKS5')
      expect(proxy.tunnels()).toBeGreaterThan(0)
      const error = await denied.getMe().catch((caught: TelegramApiError) => caught)
      expect(error).toMatchObject({ kind: 'network' })
      expect((error as Error).message).toContain('через прокси:')
      for (const part of ['wrong-pass', 'averra', '127.0.0.1', String(proxy.port)]) {
        expect((error as Error).message).not.toContain(part)
      }
    } finally {
      await api.close()
      await denied.close()
      await proxy.close()
    }
  })

  it('SOCKS5: логин кириллицей и пароль со спецсимволами уходят раскодированными', async () => {
    const user = 'студия'
    const password = 'p@ss:w/o%rd#1'
    const proxy = await startSocksProxy(user, password)
    // Так адрес прокси пишут по правилам URL: спецсимволы и кириллица — %-кодами
    const url = `socks5://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${proxy.port}`
    const api = connect_(url)
    try {
      expect((await api.getMe()).username).toBe('averra_test_bot')
      expect(proxy.tunnels()).toBeGreaterThan(0)
    } finally {
      await api.close()
      await proxy.close()
    }
  })

  it('адрес прокси не разобрать: клиент создаётся, вызов — ошибка сети без пароля', async () => {
    // Сохранён до проверки схемой или схема чего-то не знает: undici бросил бы с адресом в тексте
    for (const proxy of [
      'socks5://user:pa#ssw0rd@127.0.0.1:1080',
      'http://user:se?cret@127.0.0.1:3128',
      'socks5://user:pa%zz@127.0.0.1:1080',
      'http://user:se-cret@[1:2]:3128',
    ]) {
      const api = connect_(proxy)
      try {
        const error = await api.getMe().catch((caught: TelegramApiError) => caught)
        expect(error, proxy).toMatchObject({
          kind: 'network',
          message: expect.stringContaining('%-кодами'),
        })
        expect((error as Error).message).not.toContain('ssw0rd')
        expect((error as Error).message).not.toContain('cret')
      } finally {
        await api.close()
      }
    }
  })

  it('getUpdates: длинный опрос, offset подтверждает обработанное', async () => {
    const api = connect_()
    try {
      fake.pushStart('abc')
      const first = await api.getUpdates({ timeoutSec: 1 })
      expect(first.at(-1)?.message?.text).toBe('/start abc')
      const last = first.at(-1)?.update_id ?? 0
      expect(await api.getUpdates({ offset: last + 1, timeoutSec: 1 })).toEqual([])
    } finally {
      await api.close()
    }
  })
})

/** Текст так, как его считает Telegram: без тегов и с разобранными &amp; &lt; &gt; */
const visible = (html: string) =>
  html
    .replace(/<\/?b>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

describe('текст для Telegram', () => {
  it('экранирует & < > у всего из данных', () => {
    expect(escapeTelegramHtml('<b>"Ромашка" & Ко</b>')).toBe(
      '&lt;b&gt;"Ромашка" &amp; Ко&lt;/b&gt;',
    )
    const text = telegramText({
      title: 'Заявка <i>',
      lines: ['a & b'],
      fields: [{ label: 'Имя<', value: '</b><a href="x">' }],
      link: { label: 'Заявка', url: 'https://admin.example.ru/leads/1?a=1&b=2' },
    })
    expect(text).toBe(
      '<b>Заявка &lt;i&gt;</b>\n\na &amp; b\n\n<b>Имя&lt;:</b> &lt;/b&gt;&lt;a href="x"&gt;\n\nЗаявка: https://admin.example.ru/leads/1?a=1&amp;b=2',
    )
  })

  it('длинные значения обрезаются, короткие остаются целыми — сообщение влезает в предел', () => {
    expect(fitValues(['ок', 'x'.repeat(100), 'y'.repeat(100)], 52)).toEqual([
      'ок',
      `${'x'.repeat(24)}…`,
      `${'y'.repeat(24)}…`,
    ])
    const text = telegramText({
      title: 'Заявка',
      lines: [],
      fields: Array.from({ length: 12 }, (_, index) => ({
        label: `Поле ${index}`,
        value: 'я'.repeat(2000),
      })),
    })
    expect(visible(text).length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT)
  })

  it('12 полей с длинными подписями и «&» в значениях — всё равно в пределе', () => {
    const text = telegramText({
      title: `Новая заявка с сайта «${'С'.repeat(80)}»`,
      lines: [`Форма «${'Ф'.repeat(80)}» на странице /${'p'.repeat(200)}`, 'Когда: сейчас'],
      fields: Array.from({ length: 12 }, (_, index) => ({
        label: `${index} ${'Подпись поля '.repeat(6)}`.slice(0, 80),
        value: '&'.repeat(1000),
      })),
      link: { label: 'Заявка в админке', url: `https://admin.example.ru/leads/${'x'.repeat(36)}` },
    })
    expect(visible(text).length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT)
    // Подписи и ссылка целы: режутся только значения
    expect(text).toContain('Заявка в админке: https://admin.example.ru/leads/')
    expect(visible(text)).toContain(`11 ${'Подпись поля '.repeat(6)}`.slice(0, 80))
  })

  it('прокси для людей — без пароля', () => {
    expect(proxyForDisplay('socks5://user:secret@proxy.example.ru:1080')).toBe(
      'socks5://user@proxy.example.ru:1080',
    )
    expect(proxyForDisplay('http://10.0.0.1:3128')).toBe('http://10.0.0.1:3128')
    // Не разобрать — ни логина, ни пароля: что до последней «@», может быть секретом
    expect(proxyForDisplay('socks5://user:pa#ss@proxy.example.ru:1080')).toBe(
      'socks5://proxy.example.ru:1080',
    )
    expect(proxyForDisplay('http://user:p@ss@h.ru:3128')).toBe('http://h.ru:3128')
  })
})
