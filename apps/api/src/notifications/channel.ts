import type { NotificationChannelKind } from '@averra/schema'
import type { z } from 'zod'
import type { DbOrTx } from '../mail/outbox'
import type { EventId, NotificationMessage } from './events'

// Интерфейс канала уведомлений — как Mailer у почты и MediaStorage у медиатеки: ядро (маршруты
// событий, очередь, обработчик, вид каналов в админке, «Проверить», сводка и письмо о смене
// получателей) знает каналы только через него. Новый канал — адаптер рядом с channels/email.ts
// и channels/telegram.ts и строка в channels/index.ts. Без Node API: сеть (HTTP-клиент Telegram)
// приходит фабрикой из index.ts

/** Получатель в канале: адрес (почта, chat id) и строка настроек, если она есть */
export type NotificationTarget = {
  address: string
  /** Получатель из notification_recipients. Нет — адрес взят не из настроек (владельцы) */
  recipientId?: string | null
}

/** Событие в очередь: id и уже проверенные схемой события данные */
export type QueuedEvent = { event: EventId; data: unknown }

/** Транзакция действия и к чему относится уведомление (сайт, заявка) */
export type EnqueueContext = {
  tx: DbOrTx
  now: Date
  siteId?: string | undefined
  leadId?: string | undefined
}

/**
 * Настройки канала из базы (notification_channels) и его секрет — уже расшифрованный (или почему
 * нет). Строки нет — канал по умолчанию: enabled по defaultEnabled адаптера, настроек нет
 */
export type ChannelConfig = {
  enabled: boolean
  settings: Record<string, unknown>
  secret: ChannelSecret
}

/** Секрет канала: нет, расшифрован или не читается (текст для владельца, без секрета) */
export type ChannelSecret =
  | { state: 'none' }
  | { state: 'ok'; value: string }
  | { state: 'unreadable'; reason: string }

/** Что ещё, кроме своих настроек, решает готовность канала: почта процесса */
export type ReadinessContext = { mailEnabled: boolean; mailReason: string | null }

export type Readiness = { ok: true } | { ok: false; reason: string }

/**
 * Ошибка отправки. kind решает, что делать очереди:
 * - retry — попробовать это сообщение позже с растущей паузой (429, сбой сервера канала);
 * - permanent — повторять бессмысленно (чат не найден, бот заблокирован): сообщение не отправлено;
 * - channel — сломался канал целиком (сеть, прокси, токен): попытка не тратится, канал выжидает.
 * Текст — по-русски и без секретов
 */
export class ChannelSendError extends Error {
  override name = 'ChannelSendError'
  constructor(
    message: string,
    readonly kind: 'retry' | 'permanent' | 'channel',
    /** Канал сам сказал, через сколько повторить (Telegram: retry_after) */
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

/** Шаг проверки канала («Проверить» в разделе «Уведомления») */
export type ChannelCheckStep = { step: string; ok: boolean; message: string }

/** Итог «Проверить»: по шагам, как у проверки SMTP */
export type ChannelCheckResult = { ok: boolean; steps: ChannelCheckStep[] }

/** Получатель в канале так, как его хранит модуль: адрес и название (у чата) */
export type RecipientRef = { address: string; label: string | null }

/**
 * Что ядро даёт проверке канала: кто проверяет, как назвать установку, получатели этого канала
 * (всех аудиторий) и как поставить тестовое уведомление в очередь — тем же путём, что настоящее
 */
export type ChannelCheckContext = {
  readiness: ReadinessContext
  user: { name: string; email: string }
  installation: string
  recipients: readonly RecipientRef[]
  /** Поставить «Проверку уведомлений» по адресам этого канала. Сколько поставлено */
  queueTest(addresses: readonly string[]): Promise<number>
}

type Scalar = string | number | boolean | null

/**
 * Что канал рассказывает о себе админке: плоские значения и один уровень вложенности (бот: имя
 * и логин). Не рекурсивный JSON: тип ответа API выводится в админку, и рекурсия его не пускает
 */
export type ChannelDetails = { [key: string]: Scalar | { [key: string]: Scalar } }

/**
 * Кому канал описывает себя: owner — владельцу в «Каналах» (всё, кроме секретов), site — клиенту
 * сайта (только то, что нужно, чтобы привязать получателя)
 */
export type DescribeView = 'owner' | 'site'

export type NotificationChannel = {
  kind: NotificationChannelKind
  title: string
  /** Схема адреса получателя: почта, chat id. Через неё проходит каждый новый получатель */
  address: z.ZodType<string>
  /** Схема открытых настроек канала (notification_channels.settings) */
  settings: z.ZodType<Record<string, unknown>>
  /** Схема секрета канала (расшифрованный JSON). Нет — секрета у канала нет */
  secret?: z.ZodType
  /** Получатель словами: письмо о смене получателей, сводка «куда уходят заявки» */
  label(recipient: RecipientRef): string
  /**
   * Как канал видит админка — без секретов (токен и пароль прокси не уходят никогда). null —
   * рассказывать нечего
   */
  describe(config: ChannelConfig, view: DescribeView): ChannelDetails | null
  /** «Проверить»: подключение и доставка по шагам — сразу или через очередь (queueTest) */
  check(config: ChannelConfig, context: ChannelCheckContext): Promise<ChannelCheckResult>
  /** Включён ли канал, пока владелец его не трогал */
  defaultEnabled: boolean
  /** События, которые канал не возит: «почта не работает» по почте не дойдёт */
  skips: readonly EventId[]
  /** Можно ли сейчас ставить в канал. Нет — почему: так это видит админка */
  ready(config: ChannelConfig, context: ReadinessContext): Readiness
  /**
   * Поставить уведомление в очередь в транзакции действия (заявки): откатится действие —
   * откатится и уведомление. Почта ставит письма в свою очередь, остальные — в notification_outbox
   */
  enqueue(context: EnqueueContext, item: QueuedEvent, targets: NotificationTarget[]): Promise<void>
  /** Отправить одно сообщение из notification_outbox. Ошибка — ChannelSendError */
  send?(
    config: ChannelConfig,
    address: string,
    message: NotificationMessage,
  ): Promise<{
    messageId: string
  }>
}

export type ChannelRegistry = Readonly<Record<NotificationChannelKind, NotificationChannel>>

/**
 * Контекст шифрования секрета канала (AAD): запись, переставленная в строку другого канала,
 * не расшифруется
 */
export const channelSecretContext = (kind: string) => `notification_channels.${kind}:installation`
