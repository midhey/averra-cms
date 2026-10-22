import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { TelegramChat, TelegramUpdate } from '../telegram/api'

// Фейковый Bot API Telegram для тестов API и e2e: тот же протокол (POST /bot<токен>/<метод>,
// ответ { ok, result } или { ok: false, error_code, description }), но в памяти. Тест видит
// отправленные сообщения, кладёт «Старт» из чата и заставляет сервер отказать.
// Обновления — как у Telegram: у каждого бота свои update_id, offset подтверждает (удаляет) всё,
// что меньше него, — и то, что пришло во время длинного опроса, тоже. Id следующего обновления
// тест может задать: после недели без обновлений Telegram выбирает его случайно

export type FakeTelegramMessage = { chatId: string; text: string; parseMode?: string }

export type FakeBot = { id: number; username: string; name: string }

export type FakeTelegramOptions = {
  token: string
  bot?: FakeBot
  /** Ещё боты на том же сервере (смена бота): свой токен, свои update_id */
  otherBots?: { token: string; bot: FakeBot }[]
  /** Порт: e2e слушает свой постоянный, тесты — свободный */
  port?: number
  /** Сколько длинный опрос держит ответ, если обновлений нет: в тестах — коротко */
  pollWaitMs?: number
}

/** Куда положить обновление: боту с этим токеном (по умолчанию — первому) и с этим id */
export type PushOptions = { token?: string; updateId?: number }

type Failure = { status: number; description: string; retryAfter?: number; migrateTo?: number }

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })

export async function startFakeTelegram({
  token,
  bot = { id: 7000001, username: 'averra_test_bot', name: 'Averra Test' },
  port = 0,
  pollWaitMs = 300,
  otherBots = [],
}: FakeTelegramOptions) {
  const messages: FakeTelegramMessage[] = []
  const calls: string[] = []
  // Обновления у каждого бота свои: ждут, пока их не подтвердит offset
  const bots = new Map(
    [{ token, bot }, ...otherBots].map((entry) => [
      entry.token,
      { bot: entry.bot, updates: [] as TelegramUpdate[], nextUpdateId: 100 },
    ]),
  )
  const botOf = (key = token) => {
    const state = bots.get(key)
    if (!state) throw new Error(`Фейковый Telegram не знает бота с токеном ${key}`)
    return state
  }
  let nextMessageId = 1
  // Отказы: следующий вызов sendMessage (в чат или в любой) получит эту ошибку
  const failures: { chatId?: string; failure: Failure }[] = []
  // Отказ опроса getUpdates (webhook у бота — 409): пока задан, каждый опрос его получает
  let updatesFailure: Failure | undefined
  const waiters = new Set<() => void>()

  const server = createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    const match = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(request.url ?? '')
    const state = match ? bots.get(match[1] ?? '') : undefined
    if (!match || !state) {
      send(401, { ok: false, error_code: 401, description: 'Unauthorized' })
      return
    }
    const method = match[2] ?? ''
    calls.push(method)
    const text = await readBody(request)
    const params = (text ? JSON.parse(text) : {}) as Record<string, unknown>

    if (method === 'getMe') {
      send(200, {
        ok: true,
        result: {
          id: state.bot.id,
          is_bot: true,
          first_name: state.bot.name,
          username: state.bot.username,
        },
      })
      return
    }
    if (method === 'sendMessage') {
      const chatId = String(params.chat_id)
      const index = failures.findIndex((item) => !item.chatId || item.chatId === chatId)
      if (index !== -1) {
        const [{ failure }] = failures.splice(index, 1) as [{ failure: Failure }]
        send(failure.status, {
          ok: false,
          error_code: failure.status,
          description: failure.description,
          ...(failure.retryAfter || failure.migrateTo
            ? {
                parameters: {
                  ...(failure.retryAfter ? { retry_after: failure.retryAfter } : {}),
                  ...(failure.migrateTo ? { migrate_to_chat_id: failure.migrateTo } : {}),
                },
              }
            : {}),
        })
        return
      }
      messages.push({
        chatId,
        text: String(params.text),
        ...(typeof params.parse_mode === 'string' ? { parseMode: params.parse_mode } : {}),
      })
      send(200, { ok: true, result: { message_id: nextMessageId++, chat: { id: Number(chatId) } } })
      return
    }
    if (method === 'getUpdates') {
      if (updatesFailure) {
        send(updatesFailure.status, {
          ok: false,
          error_code: updatesFailure.status,
          description: updatesFailure.description,
        })
        return
      }
      const offset = typeof params.offset === 'number' ? params.offset : undefined
      // Как у Telegram: offset подтверждает всё, что меньше него, — даже пришедшее позже
      const confirm = () => {
        if (offset !== undefined) {
          state.updates = state.updates.filter((update) => update.update_id >= offset)
        }
      }
      confirm()
      if (state.updates.length === 0 && Number(params.timeout ?? 0) > 0) {
        await new Promise<void>((resolve) => {
          const done = () => {
            waiters.delete(done)
            clearTimeout(timer)
            resolve()
          }
          const timer = setTimeout(done, pollWaitMs)
          waiters.add(done)
        })
      }
      confirm()
      send(200, { ok: true, result: state.updates })
      return
    }
    send(404, { ok: false, error_code: 404, description: 'Not Found: method not found' })
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo

  /** Человек нажал «Старт» по ссылке с кодом (в группе команда приходит с именем бота) */
  function push(update: Omit<TelegramUpdate, 'update_id'>, options: PushOptions) {
    const state = botOf(options.token)
    if (options.updateId !== undefined) state.nextUpdateId = options.updateId
    state.updates.push({ update_id: state.nextUpdateId++, ...update })
    for (const wake of [...waiters]) wake()
  }

  function pushStart(
    code: string | undefined,
    chat: Partial<TelegramChat> = {},
    mention = false,
    options: PushOptions = {},
  ) {
    const fullChat: TelegramChat = { id: 555000111, type: 'private', first_name: 'Анна', ...chat }
    const command = mention ? `/start@${botOf(options.token).bot.username}` : '/start'
    push(
      {
        message: {
          message_id: nextMessageId++,
          date: Math.floor(Date.now() / 1000),
          text: code ? `${command} ${code}` : command,
          chat: fullChat,
        },
      },
      options,
    )
    return fullChat
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    bot,
    messages,
    calls,
    pushStart,
    /** Положить любое обновление (например, старое или чужое сообщение) */
    pushUpdate(update: Omit<TelegramUpdate, 'update_id'>, options: PushOptions = {}) {
      push(update, options)
    },
    /** Обновления, которые бот ещё не подтвердил */
    pending: (key = token) => botOf(key).updates.map((update) => update.update_id),
    /** Следующая отправка (в этот чат или любой) получит ошибку */
    failNext(failure: Failure, chatId?: string) {
      failures.push({ failure, ...(chatId ? { chatId } : {}) })
    },
    /** Опрос getUpdates отвечает ошибкой (undefined — снова работает) */
    failUpdates(failure: Failure | undefined) {
      updatesFailure = failure
    },
    /** Сообщения в чат */
    messagesTo: (chatId: string) => messages.filter((message) => message.chatId === chatId),
    close: () =>
      new Promise<void>((resolve) => {
        for (const wake of [...waiters]) wake()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

export type FakeTelegram = Awaited<ReturnType<typeof startFakeTelegram>>
