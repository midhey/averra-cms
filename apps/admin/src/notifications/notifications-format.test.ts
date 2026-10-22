import { describe, expect, it } from 'vitest'
import {
  eventsLine,
  eventTitle,
  linkExpiryLabel,
  outboxStatusLabel,
  recipientName,
} from './notifications-format'

describe('раздел «Уведомления»: слова', () => {
  it('получатель — адрес почты или название чата', () => {
    expect(recipientName({ channel: 'email', address: 'a@b.ru', label: null })).toBe('a@b.ru')
    expect(recipientName({ channel: 'telegram', address: '-100', label: 'Продажи' })).toBe(
      'Продажи',
    )
    expect(recipientName({ channel: 'telegram', address: '42', label: null })).toBe('Чат 42')
  })

  it('события словами; незнакомое — как есть', () => {
    expect(eventTitle('disk.low')).toBe('Мало места на диске')
    expect(eventTitle('future.event')).toBe('future.event')
    expect(eventsLine(['backup.failed', 'mail.down'])).toBe('Бэкап не прошёл, Почта не работает')
    expect(eventsLine([])).toBe('Событий нет')
  })

  it('срок кода привязки и состояние сообщений', () => {
    const now = Date.parse('2026-10-20T10:00:00Z')
    expect(linkExpiryLabel('2026-10-20T10:14:30Z', now)).toBe('Код действует ещё 15 мин')
    expect(linkExpiryLabel('2026-10-20T09:59:00Z', now)).toBe('Код истёк')
    expect(outboxStatusLabel('failed')).toBe('не отправлено')
  })
})
