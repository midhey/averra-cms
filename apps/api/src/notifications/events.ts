import {
  MailAddress,
  MailLine,
  MailUrl,
  NOTIFICATION_EVENT_TITLES,
  type NotificationAudience,
  type NotificationEventId,
} from '@averra/schema'
import { z } from 'zod'
import type { MailTemplateId } from '../mail/templates'
import { leadNewTemplate } from '../mail/templates/lead-new'
import { leadRecipientsChangedTemplate } from '../mail/templates/lead-recipients-changed'
import { toMailLine } from '../mail/templates/line'
import { NOTIFICATION_LIMITS } from '../mail/templates/notification'

// События модуля уведомлений: что случилось, кому (аудитория) и как это сказать. Сообщение
// нейтральное — заголовок, абзацы, поля и ссылка, — каждый канал рисует его сам (почта — письмом,
// Telegram — текстом с разметкой). Без Node API: события видят маршруты

/** Нейтральное сообщение: его рисует канал. Всё здесь — текст, разметку добавляет канал */
export type NotificationMessage = {
  /** Одна строка: тема письма, жирная первая строка в Telegram */
  title: string
  lines: string[]
  fields: { label: string; value: string }[]
  link?: { label: string; url: string }
}

/** Письмо своим шаблоном вместо общего «Уведомления»: у заявки — Reply-To посетителя и таблица */
export type MailOverride = { template: MailTemplateId; data: unknown }

type EventDefinition<S extends z.ZodType> = {
  /** Кому событие: получатели заявок сайта или служебные получатели установки */
  audience: NotificationAudience
  title: string
  schema: S
  message(data: z.output<S>): NotificationMessage
  mail?(data: z.output<S>): MailOverride
}

const define = <S extends z.ZodType>(event: EventDefinition<S>) => event

const timeFormat = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Moscow',
})

/** Время по-человечески: «15 октября 2026 г. в 12:30 по Москве» */
export const formatMoscow = (iso: string) => `${timeFormat.format(new Date(iso))} по Москве`

/** Проблема появилась или ушла: служебное уведомление уходит на обоих переходах */
const ServiceState = z.enum(['raised', 'resolved'])

/**
 * Общие поля служебного события: какая установка (имя сайта и домен — у студии их много) и куда
 * смотреть в админке
 */
const serviceBase = {
  state: ServiceState,
  installation: MailLine(120),
  url: MailUrl,
}

const statusLink = (url: string) => ({ label: 'Состояние установки', url })

export const notificationEvents = {
  /**
   * Новая заявка с формы сайта. Данные — те же, что у письма lead-new: по почте уходит оно
   * (Reply-To посетителя), в остальные каналы — сообщение с полями заявки
   */
  'lead.new': define({
    audience: 'leads',
    title: NOTIFICATION_EVENT_TITLES['lead.new'],
    schema: leadNewTemplate.schema,
    message: (data) => ({
      title: `Новая заявка с сайта «${data.siteName}»`,
      lines: [
        `Форма «${data.formTitle}» на странице ${data.pagePath}`,
        `Когда: ${formatMoscow(data.createdAt)}`,
      ],
      fields: data.fields.map(({ label, value }) => ({ label, value: value === '' ? '—' : value })),
      link: { label: 'Заявка в админке', url: data.url },
    }),
    mail: (data) => ({ template: 'lead-new', data }),
  }),

  'backup.failed': define({
    audience: 'service',
    title: NOTIFICATION_EVENT_TITLES['backup.failed'],
    schema: z.strictObject({
      ...serviceBase,
      backup: MailLine(80).optional(),
      error: z.string().max(500).optional(),
    }),
    message: ({ state, installation, url, backup, error }) =>
      state === 'resolved'
        ? {
            title: `${installation}: бэкапы снова проходят`,
            lines: ['Последний бэкап прошёл и проверен восстановлением.'],
            fields: [],
            link: statusLink(url),
          }
        : {
            title: `${installation}: бэкап не прошёл`,
            lines: [
              'Последний бэкап установки не удался: данные после прошлого удачного бэкапа не защищены. Посмотрите причину и запустите бэкап снова (averra.sh backup).',
            ],
            fields: [
              ...(backup ? [{ label: 'Бэкап', value: backup }] : []),
              ...(error ? [{ label: 'Причина', value: error }] : []),
            ],
            link: statusLink(url),
          },
  }),

  'disk.low': define({
    audience: 'service',
    title: NOTIFICATION_EVENT_TITLES['disk.low'],
    schema: z.strictObject({ ...serviceBase, disk: MailLine(120), free: MailLine(40) }),
    message: ({ state, installation, url, disk, free }) =>
      state === 'resolved'
        ? {
            title: `${installation}: места на диске снова хватает`,
            // Объём не пишем: он запомнен, когда места не хватало, и в «снова хватает» соврал бы
            lines: [`Диск «${disk}»: свободного места снова больше порога.`],
            fields: [],
            link: statusLink(url),
          }
        : {
            title: `${installation}: мало места на диске`,
            lines: [
              `Диск «${disk}»: свободно ${free}. Когда место кончится, перестанут проходить бэкапы, загрузка картинок и сборка сайта.`,
            ],
            fields: [],
            link: statusLink(url),
          },
  }),

  'build.failed': define({
    audience: 'service',
    title: NOTIFICATION_EVENT_TITLES['build.failed'],
    schema: z.strictObject({
      ...serviceBase,
      siteName: MailLine(80),
      error: z.string().max(500).optional(),
    }),
    message: ({ state, installation, url, siteName, error }) =>
      state === 'resolved'
        ? {
            title: `${installation}: сайт «${siteName}» снова собирается`,
            lines: ['Последняя сборка прошла, на сайте свежая версия.'],
            fields: [],
            link: { label: 'Сборка сайта', url },
          }
        : {
            title: `${installation}: сборка сайта «${siteName}» упала`,
            lines: [
              'Сайт не собрался после публикации: посетители видят прежнюю версию. Причина — в журнале сборок, повторить — «Собрать заново».',
            ],
            fields: error ? [{ label: 'Причина', value: error }] : [],
            link: { label: 'Сборка сайта', url },
          },
  }),

  'mail.down': define({
    audience: 'service',
    title: NOTIFICATION_EVENT_TITLES['mail.down'],
    schema: z.strictObject({
      ...serviceBase,
      failing: z.int().nonnegative(),
      error: z.string().max(500).optional(),
    }),
    message: ({ state, installation, url, failing, error }) =>
      state === 'resolved'
        ? {
            title: `${installation}: почта снова работает`,
            lines: ['Письма из очереди уходят.'],
            fields: [],
            link: { label: 'Почта', url },
          }
        : {
            title: `${installation}: почта не работает`,
            lines: [
              `Письма не уходят дольше 15 минут: в очереди с ошибкой ${failing}. Не приходят сброс пароля, приглашения и письма о заявках. Проверьте настройки почты.`,
            ],
            fields: error ? [{ label: 'Последняя ошибка', value: error }] : [],
            link: { label: 'Почта', url },
          },
  }),

  /**
   * Владелец нажал «Обновить» в админке (POST /api/status/update): кто и до какой версии. Разовое
   * событие — без «снова в порядке»; чем кончилось обновление, видно в «Состоянии установки»
   */
  'update.requested': define({
    audience: 'service',
    title: NOTIFICATION_EVENT_TITLES['update.requested'],
    schema: z.strictObject({
      installation: MailLine(120),
      url: MailUrl,
      from: MailLine(128),
      to: MailLine(40),
      by: MailLine(100),
      byEmail: MailAddress,
      requestedAt: z.iso.datetime({ offset: true }),
    }),
    message: ({ installation, url, from, to, by, byEmail, requestedAt }) => ({
      title: `${installation}: запрошено обновление до ${to}`,
      lines: [
        'Владелец нажал «Обновить» в админке. Сервер сделает бэкап, обновит установку и проверит её, а если новая версия не встанет — вернёт прежнюю. Админка и приём заявок недоступны минуту-две, сайт открыт.',
      ],
      fields: [
        { label: 'Версия', value: `${from} → ${to}` },
        { label: 'Кто', value: `${by} (${byEmail})` },
        { label: 'Когда', value: formatMoscow(requestedAt) },
      ],
      link: statusLink(url),
    }),
  }),

  /**
   * Получатели уведомлений о заявках сменились: уходит владельцам и прежним получателям. Данные —
   * как у письма lead-recipients-changed: по почте уходит оно
   */
  'lead.recipients_changed': define({
    audience: 'leads',
    title: 'Получатели уведомлений о заявках изменены',
    schema: leadRecipientsChangedTemplate.schema,
    message: ({ siteName, changedBy, changedByEmail, changedAt, recipients, targets }) => {
      const where = targets ?? recipients ?? []
      return {
        title: `Сайт «${siteName}»: получатели уведомлений о заявках изменены`,
        lines: [
          'Если смену никто не согласовывал, верните получателей в разделе «Уведомления» админки и смените пароль учётной записи, с которой это сделали.',
        ],
        fields: [
          { label: 'Кто', value: `${changedBy} (${changedByEmail})` },
          { label: 'Когда', value: formatMoscow(changedAt) },
          {
            label: 'Теперь заявки приходят',
            value: where.length > 0 ? where.join(', ') : 'владельцам админки',
          },
        ],
      }
    },
    mail: (data) => ({ template: 'lead-recipients-changed', data }),
  }),

  /** «Проверить» в разделе «Уведомления»: тестовое сообщение получателям */
  'notification.test': define({
    audience: 'leads',
    title: 'Проверка уведомлений',
    schema: z.strictObject({
      siteName: MailLine(120),
      sentAt: z.iso.datetime({ offset: true }),
      by: MailLine(100),
      byEmail: MailAddress,
    }),
    message: ({ siteName, sentAt, by, byEmail }) => ({
      title: `Проверка уведомлений «${siteName}»`,
      lines: [
        'Это тестовое сообщение из раздела «Уведомления» админки Averra: уведомления сюда доходят.',
      ],
      fields: [
        { label: 'Отправил', value: `${by} (${byEmail})` },
        { label: 'Когда', value: formatMoscow(sentAt) },
      ],
    }),
  }),
} as const

export type EventId = keyof typeof notificationEvents

/** Данные события так, как их передают в notify */
export type EventData<E extends EventId> = z.input<(typeof notificationEvents)[E]['schema']>

/** Подписка получателя — только на события из схемы (NotificationEventId), служебные — нет */
export type SubscribableEvent = NotificationEventId

const eventIds = Object.keys(notificationEvents) as EventId[]

export const isEventId = (value: string): value is EventId => (eventIds as string[]).includes(value)

/** Событие словами — для админки (последние сообщения). Неизвестное — как есть */
export const eventTitle = (event: string) =>
  isEventId(event) ? notificationEvents[event].title : event

/** Данные события не прошли его схему: при постановке в очередь или перед отправкой */
export class NotificationDataError extends Error {
  override name = 'NotificationDataError'
  constructor(
    readonly event: string,
    readonly issues: z.core.$ZodIssue[],
  ) {
    super(
      `Данные уведомления «${event}» не прошли проверку: ` +
        issues.map((issue) => `${issue.path.join('.') || 'данные'} — ${issue.message}`).join('; '),
    )
  }
}

/** Проверяет данные события его схемой. Ошибка — NotificationDataError */
export function parseEventData(event: EventId, data: unknown) {
  const parsed = notificationEvents[event].schema.safeParse(data)
  if (!parsed.success) throw new NotificationDataError(event, parsed.error.issues)
  return parsed.data
}

type AnyDefinition = {
  message(data: unknown): NotificationMessage
  mail?(data: unknown): MailOverride
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`

/**
 * Сообщение в пределах общего «Уведомления» (NOTIFICATION_LIMITS). Заголовок склеен из данных:
 * название установки (до 120 знаков) и сайта (до 80) дают больше 200 — тогда он обрезается с «…»,
 * а не роняет письмо. Telegram режет по своему пределу сам (telegram/format.ts)
 */
export function fitMessage(message: NotificationMessage): NotificationMessage {
  const limits = NOTIFICATION_LIMITS
  return {
    title: toMailLine(message.title, limits.title, 'Уведомление Averra'),
    lines: message.lines
      .filter((line) => line.trim() !== '')
      .slice(0, limits.lines)
      .map((line) => clip(line, limits.line)),
    fields: message.fields.slice(0, limits.fields).map(({ label, value }) => ({
      label: toMailLine(label, limits.label, 'Поле'),
      value: clip(value, limits.value),
    })),
    ...(message.link
      ? {
          link: {
            label: toMailLine(message.link.label, limits.label, 'Ссылка'),
            url: message.link.url,
          },
        }
      : {}),
  }
}

/**
 * Сообщение события из данных (проверяются схемой ещё раз: данные из очереди могли лечь до смены
 * схемы), подогнанное под пределы сообщения. Ошибка — NotificationDataError
 */
export function renderNotification(event: EventId, data: unknown): NotificationMessage {
  const parsed = parseEventData(event, data)
  return fitMessage((notificationEvents[event] as unknown as AnyDefinition).message(parsed))
}

/** Письмо своим шаблоном, если у события он есть */
export function mailOverrideOf(event: EventId, data: unknown): MailOverride | undefined {
  const parsed = parseEventData(event, data)
  return (notificationEvents[event] as unknown as AnyDefinition).mail?.(parsed)
}
