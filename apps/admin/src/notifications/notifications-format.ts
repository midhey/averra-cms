import {
  NotificationEventId as EventIdSchema,
  NOTIFICATION_EVENT_TITLES,
  type NotificationEventId,
} from '@averra/schema'

// Слова раздела «Уведомления»: получатели, события, состояние сообщений. Чистые функции —
// их проверяют тесты, а экран только показывает

/** Получатель так, как его отдаёт API */
export type RecipientView = {
  id: string
  channel: string
  address: string
  label: string | null
  events: string[]
}

/** Как назвать получателя: адрес почты или название чата (chat id — если названия нет) */
export const recipientName = (recipient: Pick<RecipientView, 'channel' | 'address' | 'label'>) =>
  recipient.channel === 'email'
    ? recipient.address
    : (recipient.label ?? `Чат ${recipient.address}`)

/** Событие словами; незнакомое (из будущей версии) — как есть */
export function eventTitle(event: string) {
  const parsed = EventIdSchema.safeParse(event)
  return parsed.success ? NOTIFICATION_EVENT_TITLES[parsed.data as NotificationEventId] : event
}

/** Список событий получателя словами: «Бэкап не прошёл, Мало места на диске» */
export const eventsLine = (events: readonly string[]) =>
  events.length === 0 ? 'Событий нет' : events.map(eventTitle).join(', ')

const outboxStatuses: Record<string, string> = {
  pending: 'ждёт',
  sending: 'отправляется',
  sent: 'отправлено',
  failed: 'не отправлено',
}

/** Состояние сообщения очереди словами */
export const outboxStatusLabel = (status: string) => outboxStatuses[status] ?? status

/** Сколько минут осталось коду привязки: «ещё 14 мин», «код истёк» */
export function linkExpiryLabel(expiresAt: string, now = Date.now()) {
  const minutes = Math.ceil((Date.parse(expiresAt) - now) / 60_000)
  return minutes > 0 ? `Код действует ещё ${minutes} мин` : 'Код истёк'
}

/** Шаг проверки Telegram для диктора и глаз: «Пройден: …» / «Не пройден: …» */
export const checkStepLabel = (step: { ok: boolean }) => (step.ok ? 'Пройден:' : 'Не пройден:')
