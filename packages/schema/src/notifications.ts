import { z } from 'zod'
import { hasHeaderBreak, MailAddress } from './mail'
import { CurrentPassword } from './mail-settings'

// Уведомления (раздел «Уведомления» в админке): события, каналы и получатели. Схемы входа API
// строгие, как у почты: лишнее поле — ошибка, а не тихо выброшенные данные

/**
 * Кому событие: заявки сайта (получателей меняют владелец и клиент) или служебные события
 * установки для студии (только владелец)
 */
export const NotificationAudience = z.enum(['leads', 'service'])
export type NotificationAudience = z.infer<typeof NotificationAudience>

/** Служебные события установки: о них узнаёт студия, которая её сопровождает */
export const ServiceEventId = z.enum([
  'backup.failed',
  'disk.low',
  'build.failed',
  'mail.down',
  'update.requested',
])
export type ServiceEventId = z.infer<typeof ServiceEventId>

/** События, на которые подписывают получателя */
export const NotificationEventId = z.enum(['lead.new', ...ServiceEventId.options])
export type NotificationEventId = z.infer<typeof NotificationEventId>

/** События словами: одни для админки, писем и сообщений */
export const NOTIFICATION_EVENT_TITLES: Record<NotificationEventId, string> = {
  'lead.new': 'Новая заявка',
  'backup.failed': 'Бэкап не прошёл',
  'disk.low': 'Мало места на диске',
  'build.failed': 'Сборка сайта упала',
  'mail.down': 'Почта не работает',
  'update.requested': 'Запрошено обновление',
}

/** Когда приходит служебное уведомление: для подсказок в админке */
export const SERVICE_EVENT_HINTS: Record<ServiceEventId, string> = {
  'backup.failed': 'последний бэкап по таймеру или руками не удался',
  'disk.low': 'свободно меньше 1 ГБ или 10% диска',
  'build.failed': 'сайт не собрался после публикации, на сайте прежняя версия',
  'mail.down': 'письма не уходят дольше 15 минут: сервер не пускает или отказал отправителю',
  'update.requested': 'владелец нажал «Обновить» в админке: кто и до какой версии',
}

/** Сколько адресов почты у одной аудитории: как было у адресов уведомлений о заявках */
export const NOTIFICATION_EMAILS_MAX = 10

/** Сколько чатов Telegram можно привязать к одной аудитории */
export const NOTIFICATION_CHATS_MAX = 10

/** Сколько минут живёт код привязки чата: человек открывает ссылку и жмёт «Старт» сразу */
export const TELEGRAM_LINK_TTL_MINUTES = 15

const emails = z
  .array(MailAddress.transform((address) => address.toLowerCase()))
  .max(NOTIFICATION_EMAILS_MAX, `До ${NOTIFICATION_EMAILS_MAX} адресов`)
  .refine((list) => new Set(list).size === list.length, 'Адреса повторяются')

/** Адреса почты для уведомлений о заявках сайта. Пусто и без чатов — письма владельцам */
export const LeadEmailRecipients = z.strictObject({ addresses: emails })
export type LeadEmailRecipients = z.infer<typeof LeadEmailRecipients>

const serviceEvents = z
  .array(ServiceEventId)
  .min(1, 'Отметьте хотя бы одно событие')
  .refine((list) => new Set(list).size === list.length, 'События повторяются')

/** Адреса почты для служебных событий, у каждого — свои события */
export const ServiceEmailRecipients = z.strictObject({
  recipients: z
    .array(
      z.strictObject({
        address: MailAddress.transform((address) => address.toLowerCase()),
        events: serviceEvents,
      }),
    )
    .max(NOTIFICATION_EMAILS_MAX, `До ${NOTIFICATION_EMAILS_MAX} адресов`)
    .refine(
      (list) => new Set(list.map((item) => item.address)).size === list.length,
      'Адреса повторяются',
    ),
})
export type ServiceEmailRecipients = z.infer<typeof ServiceEmailRecipients>

/** Какие служебные события получает чат */
export const ServiceRecipientEvents = z.strictObject({ events: serviceEvents })

/** Канал включён или выключен целиком */
export const NotificationChannelToggle = z.strictObject({ enabled: z.boolean() })

/** Каналы уведомлений. Новый канал — строка здесь и адаптер в API */
export const NotificationChannelKind = z.enum(['email', 'telegram'])
export type NotificationChannelKind = z.infer<typeof NotificationChannelKind>

/** Токен бота от @BotFather: «123456789:AA…». Пробелы по краям — следы копирования */
export const TelegramBotToken = z
  .string()
  .trim()
  .regex(
    /^[0-9]{5,16}:[A-Za-z0-9_-]{30,64}$/,
    'Токен бота — как его выдал @BotFather: цифры, двоеточие и 35 знаков',
  )

/** Ошибки адреса прокси: их видят форма и ответ API у поля proxy */
export const PROXY_MESSAGES = {
  format:
    'Адрес прокси вида socks5://логин:пароль@host:1080 или http://host:3128 — со схемой и портом',
  host: 'Хост прокси — имя вроде proxy.example.ru или адрес вроде 10.0.0.1 или [::1]',
  login:
    'Логин прокси пустой: впишите логин перед «@» (и двоеточием с паролем) или уберите «@», ' +
    'если прокси без логина',
  userinfo:
    'Спецсимволы в логине и пароле прокси — %-кодами: # → %23, ? → %3F, @ → %40, / → %2F, ' +
    '% → %25, \\ → %5C, пробел → %20, двоеточие в логине → %3A',
} as const

/**
 * Схема адрес пропустила, а URL его не принял. Чаще всего виноват хост (IPv6 без скобок или
 * с неверной записью), реже — логин и пароль: текст называет оба, а не уводит к одному
 */
export const PROXY_UNPARSED =
  'Адрес прокси не разобрать: проверьте хост (IPv6 — в квадратных скобках) и порт; ' +
  'спецсимволы в логине и пароле — %-кодами'

/** Прокси по частям: логин и пароль раскодированы (пустые — их нет), порт — число */
export type ProxyParts = {
  scheme: 'http' | 'https' | 'socks5' | 'socks'
  username: string
  password: string
  host: string
  port: number
}

const PROXY_HEAD = /^(https?|socks5?):\/\/(.*?)\/?$/
// Знак логина и пароля: всё, кроме разделителей URL (: @ / ? # \), пробелов и голого %, или %-код.
// Разделители в пароле URL прочёл бы по-своему (# — начало фрагмента), поэтому только %-кодами
const LOGIN = /^(?:[^\s:@/?#\\%]|%[0-9A-Fa-f]{2})+$/
const PASSWORD = /^(?:[^\s@/?#\\%]|%[0-9A-Fa-f]{2})*$/
const HOST_PORT = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):([0-9]{1,5})$/
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/
const OCTET = /^(?:0|[1-9][0-9]{0,2})$/

const decoded = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

/**
 * Имя хоста или IPv4. Последняя метка из цифр — это IPv4, и только из четырёх октетов до 255:
 * «1.2.3» или «010.0.0.1» URL прочёл бы как другой адрес (1.2.0.3, 8.0.0.1). Имя кончается
 * меткой с буквы — как у доменов и имён сервисов docker
 */
function validHost(host: string) {
  if (host.startsWith('[')) return true
  const labels = host.split('.')
  if (host.length > 253 || !labels.every((label) => LABEL.test(label))) return false
  const last = labels.at(-1) ?? ''
  if (/^[A-Za-z]/.test(last)) return true
  return labels.length === 4 && labels.every((label) => OCTET.test(label) && Number(label) <= 255)
}

/**
 * Разобрать адрес прокси без API среды (схему читает и админка, и API): схема http, https,
 * socks5 (или socks), по желанию логин и пароль, хост и порт, без пути. Логин и пароль — до
 * последней «@»; API сверяет этот разбор с URL, прежде чем ходить через прокси
 */
export function splitProxyUrl(value: string): ProxyParts | { error: keyof typeof PROXY_MESSAGES } {
  const head = PROXY_HEAD.exec(value)
  if (!head) return { error: 'format' }
  const scheme = head[1] as ProxyParts['scheme']
  const rest = head[2] ?? ''
  const at = rest.lastIndexOf('@')
  const hostPort = HOST_PORT.exec(at === -1 ? rest : rest.slice(at + 1))
  if (!hostPort) return { error: 'format' }
  const host = hostPort[1] ?? ''
  const port = Number(hostPort[2])
  if (port < 1 || port > 65535) return { error: 'format' }
  if (!validHost(host)) return { error: 'host' }
  if (at === -1) return { scheme, username: '', password: '', host, port }
  const userinfo = rest.slice(0, at)
  const colon = userinfo.indexOf(':')
  const login = colon === -1 ? userinfo : userinfo.slice(0, colon)
  const secret = colon === -1 ? '' : userinfo.slice(colon + 1)
  if (login === '') return { error: 'login' }
  if (!LOGIN.test(login) || !PASSWORD.test(secret)) return { error: 'userinfo' }
  const username = decoded(login)
  const password = decoded(secret)
  // %-коды, которые не складываются в UTF-8 (%FF): прокси получил бы не тот пароль
  if (username === undefined || password === undefined) return { error: 'userinfo' }
  return { scheme, username, password, host, port }
}

/**
 * Прокси для Telegram: http://, https:// или socks5://, хост и порт, логин и пароль — по желанию.
 * Спецсимволы в логине и пароле — %-кодами, как требует URL
 */
export const TelegramProxy = z
  .string()
  .trim()
  .max(500)
  .superRefine((value, ctx) => {
    if (hasHeaderBreak(value)) {
      ctx.addIssue({ code: 'custom', message: 'Адрес прокси — одной строкой' })
      return
    }
    const parts = splitProxyUrl(value)
    if ('error' in parts) ctx.addIssue({ code: 'custom', message: PROXY_MESSAGES[parts.error] })
  })

/**
 * Сохранить бота: токен (пусто — оставить сохранённый), прокси (нет поля — оставить сохранённый,
 * пусто — без прокси) и свой пароль от админки — как у SMTP: через бота уходят заявки
 * с персональными данными
 */
export const SaveTelegramChannel = z.strictObject({
  token: z.union([z.literal(''), TelegramBotToken]),
  proxy: z.union([z.literal(''), TelegramProxy]).optional(),
  currentPassword: CurrentPassword,
})
export type SaveTelegramChannel = z.infer<typeof SaveTelegramChannel>

export const DeleteTelegramChannel = z.strictObject({ currentPassword: CurrentPassword })

/** Chat id Telegram: число, у групп — отрицательное */
export const TelegramChatId = z.string().regex(/^-?[0-9]{1,20}$/, 'Chat id Telegram — число')

/**
 * Как канал Telegram описывает себя админке (describe адаптера): бот — всем, кто привязывает чат,
 * прокси без пароля и состояние токена — только владельцу. Сам токен не уходит никогда
 */
export const TelegramChannelDetails = z.object({
  bot: z.object({ username: z.string(), name: z.string() }).nullable(),
  proxy: z.string().nullable().optional(),
  token: z.enum(['set', 'unreadable']).nullable().optional(),
})
export type TelegramChannelDetails = z.infer<typeof TelegramChannelDetails>
