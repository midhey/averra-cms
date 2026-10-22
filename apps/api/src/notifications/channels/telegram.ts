import { NOTIFICATION_CHATS_MAX, type TelegramChannelDetails, TelegramChatId } from '@averra/schema'
import { z } from 'zod'
import {
  type ChannelCheckStep,
  type ChannelConfig,
  ChannelSendError,
  type NotificationChannel,
} from '../channel'
import { enqueueNotifications } from '../outbox'
import {
  proxyForDisplay,
  TelegramApiError,
  type TelegramApiFactory,
  type TelegramConnection,
} from '../telegram/api'
import { telegramText } from '../telegram/format'

// Telegram как канал уведомлений: сообщения ставятся в очередь уведомлений (notification_outbox),
// а уходят через Bot API (sendMessage) фабрикой из index.ts — напрямую или через прокси.
// Получатели — чаты, привязанные одноразовым кодом (telegram/binder.ts)

/** Секрет канала (зашифрован в notification_channels): токен бота и прокси с паролем */
export const TelegramSecret = z.strictObject({
  token: z.string().min(1),
  proxy: z.string().nullable(),
})

/** Открытые настройки: кто бот (для ссылок t.me) и прокси без пароля */
export const TelegramSettings = z.object({
  botId: z.number(),
  botUsername: z.string().min(1),
  botName: z.string(),
  proxy: z.string().nullable(),
})
export type TelegramSettings = z.infer<typeof TelegramSettings>

/** Подключение из настроек канала. Нет — канал не настроен или секрет не читается */
export function telegramConnectionOf(config: ChannelConfig): TelegramConnection | undefined {
  if (config.secret.state !== 'ok') return undefined
  try {
    const parsed = TelegramSecret.safeParse(JSON.parse(config.secret.value))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export const telegramSettingsOf = (config: ChannelConfig) => {
  const parsed = TelegramSettings.safeParse(config.settings)
  return parsed.success ? parsed.data : undefined
}

/** Ошибка Bot API — в язык очереди: что делать с сообщением */
export function sendErrorOf(error: TelegramApiError) {
  switch (error.kind) {
    case 'network':
    case 'unauthorized':
    case 'conflict':
      // Сломан канал целиком: повторится на любом сообщении — канал выжидает, попытки целы
      return new ChannelSendError(error.message, 'channel')
    case 'forbidden':
    case 'bad_request':
      return new ChannelSendError(error.message, 'permanent')
    case 'rate_limited':
    case 'server':
      return new ChannelSendError(error.message, 'retry', error.retryAfterMs)
  }
}

function ready(config: ChannelConfig) {
  if (config.secret.state === 'none' || !telegramSettingsOf(config)) {
    return { ok: false as const, reason: 'Бот Telegram не настроен' }
  }
  if (config.secret.state === 'unreadable')
    return { ok: false as const, reason: config.secret.reason }
  if (!config.enabled) {
    return { ok: false as const, reason: 'Telegram выключен в разделе «Уведомления»' }
  }
  return { ok: true as const }
}

/**
 * Telegram в админке: бот (клиенту — только он, чтобы собрать ссылку привязки), владельцу ещё
 * прокси без пароля и состояние токена. Сам токен — никогда
 */
function describe(config: ChannelConfig, view: 'owner' | 'site'): TelegramChannelDetails {
  const settings = telegramSettingsOf(config)
  const bot = settings ? { username: settings.botUsername, name: settings.botName } : null
  if (view === 'site') return { bot }
  return {
    bot,
    proxy: settings?.proxy ?? null,
    token:
      config.secret.state === 'ok'
        ? 'set'
        : config.secret.state === 'unreadable'
          ? 'unreadable'
          : null,
  }
}

export function telegramChannel(api: TelegramApiFactory): NotificationChannel {
  return {
    kind: 'telegram',
    title: 'Telegram',
    address: TelegramChatId,
    settings: TelegramSettings,
    secret: TelegramSecret,
    label: ({ address, label }) => `Telegram «${label ?? address}»`,
    describe,
    defaultEnabled: true,
    skips: [],
    ready,
    enqueue: (context, item, targets) => enqueueNotifications(context, 'telegram', item, targets),

    /**
     * «Проверить» — сразу, не через очередь: подключение и токен (getMe), потом по сообщению в
     * каждый привязанный чат. Итог по шагам, как у проверки SMTP
     */
    async check(config, { installation, recipients }) {
      const connection = telegramConnectionOf(config)
      if (!connection) {
        const reason =
          config.secret.state === 'unreadable' ? config.secret.reason : 'Бот Telegram не настроен'
        return { ok: false, steps: [{ step: 'Бот', ok: false, message: reason }] }
      }
      const steps: ChannelCheckStep[] = []
      const client = api(connection)
      try {
        try {
          const bot = await client.getMe()
          steps.push({
            step: connection.proxy
              ? `Подключение через ${proxyForDisplay(connection.proxy)}`
              : 'Подключение',
            ok: true,
            message: `Telegram отвечает, бот @${bot.username}`,
          })
        } catch (error) {
          if (!(error instanceof TelegramApiError)) throw error
          steps.push({ step: 'Подключение', ok: false, message: error.message })
          return { ok: false, steps }
        }
        // Не больше, чем бывает чатов у двух аудиторий — заявок одного сайта и служебных
        for (const chat of recipients.slice(0, NOTIFICATION_CHATS_MAX * 2)) {
          const label = `Чат «${chat.label ?? chat.address}»`
          try {
            await client.sendMessage(
              chat.address,
              telegramText({
                title: `Проверка уведомлений «${installation}»`,
                lines: [
                  'Это тестовое сообщение из раздела «Уведомления» админки Averra: бот сюда пишет.',
                ],
                fields: [],
              }),
            )
            steps.push({ step: label, ok: true, message: 'Сообщение доставлено' })
          } catch (error) {
            if (!(error instanceof TelegramApiError)) throw error
            steps.push({ step: label, ok: false, message: error.message })
          }
        }
        if (recipients.length === 0) {
          steps.push({
            step: 'Чаты',
            ok: true,
            message: 'Чатов пока нет: привяжите чат кнопкой «Привязать чат»',
          })
        }
        return { ok: steps.every((step) => step.ok), steps }
      } finally {
        await client.close().catch(() => {})
      }
    },

    async send(config, address, message) {
      const connection = telegramConnectionOf(config)
      if (!connection) throw new ChannelSendError('Бот Telegram не настроен', 'channel')
      const client = api(connection)
      try {
        return await client.sendMessage(address, telegramText(message))
      } catch (error) {
        throw error instanceof TelegramApiError ? sendErrorOf(error) : error
      } finally {
        await client.close().catch(() => {})
      }
    },
  }
}
