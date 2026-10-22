import { MailAddress, MailLine } from '@averra/schema'
import { z } from 'zod'
import { html } from '../html'
import { details, note, paragraph } from '../layout'
import { defineMailTemplate } from './define'

const changedAtFormat = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Moscow',
})

/**
 * Получателей уведомлений о заявках сайта поменяли: адреса почты, чаты Telegram или получателей
 * другого канала. Их меняют владелец и клиент сайта, а в уведомлениях о заявках — персональные
 * данные посетителей. Поэтому о смене узнают все владельцы и прежние получатели: уведённая учётка
 * клиента не перенаправит заявки молча (src/notifications/recipients.ts)
 */
export const leadRecipientsChangedTemplate = defineMailTemplate({
  id: 'lead-recipients-changed',
  title: 'Получатели уведомлений о заявках изменены',
  description:
    'Уходит владельцам и прежним получателям, когда у сайта меняют адреса или чаты уведомлений о заявках',
  schema: z.strictObject({
    siteName: MailLine(80),
    changedBy: MailLine(100),
    changedByEmail: MailAddress,
    changedAt: z.iso.datetime({ offset: true }),
    // Адреса почты — так письмо ставилось до модуля уведомлений. Новые письма несут targets
    recipients: z.array(MailAddress).max(10).optional(),
    // Все получатели словами своих каналов («manager@…», «Telegram «Отдел продаж»»): канал сам
    // называет своих получателей, письмо о новом канале не узнаёт ничего. Пусто — владельцам
    targets: z.array(MailLine(140)).max(40).optional(),
  }),
  example: {
    siteName: 'Ремонт квартир под ключ',
    changedBy: 'Анна',
    changedByEmail: 'anna@example.ru',
    changedAt: '2026-10-15T09:30:00.000Z',
    targets: ['manager@example.ru', 'sales@example.ru', 'Telegram «Отдел продаж»'],
  },
  render({ siteName, changedBy, changedByEmail, changedAt, recipients, targets }) {
    const intro = `У сайта «${siteName}» изменили, куда приходят уведомления о новых заявках.`
    const where = targets ?? recipients ?? []
    const rows: [string, string][] = [
      ['Кто', `${changedBy} (${changedByEmail})`],
      ['Когда', `${changedAtFormat.format(new Date(changedAt))} по Москве`],
      ['Теперь заявки приходят', where.length > 0 ? where.join(', ') : 'владельцам админки'],
    ]
    const warning =
      'Если смену никто не согласовывал, верните получателей в разделе «Уведомления» и смените пароль ' +
      'учётной записи, с которой это сделали: в письмах о заявках — персональные данные посетителей.'
    return {
      subject: `Получатели уведомлений о заявках изменены — ${siteName}`,
      preheader: 'Уведомления о заявках теперь уходят другим получателям',
      body: html`${paragraph(intro)}${details(rows)}${note(warning)}`,
      text: `${intro}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\n${warning}`,
    }
  },
})
