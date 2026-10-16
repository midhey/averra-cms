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
 * Адреса уведомлений о заявках сайта поменяли. Их меняют владелец и клиент сайта, а в письмах
 * о заявках — персональные данные посетителей. Поэтому о смене узнают все владельцы и прежние
 * адреса: уведённая учётка клиента не перенаправит заявки молча (modules/leads/routes.ts)
 */
export const leadRecipientsChangedTemplate = defineMailTemplate({
  id: 'lead-recipients-changed',
  title: 'Адреса уведомлений о заявках изменены',
  description:
    'Уходит владельцам и прежним адресам, когда у сайта меняют адреса уведомлений о заявках',
  schema: z.strictObject({
    siteName: MailLine(80),
    changedBy: MailLine(100),
    changedByEmail: MailAddress,
    changedAt: z.iso.datetime({ offset: true }),
    // Пусто — уведомления уходят владельцам админки
    recipients: z.array(MailAddress).max(10),
  }),
  example: {
    siteName: 'Ремонт квартир под ключ',
    changedBy: 'Анна',
    changedByEmail: 'anna@example.ru',
    changedAt: '2026-10-15T09:30:00.000Z',
    recipients: ['manager@example.ru', 'sales@example.ru'],
  },
  render({ siteName, changedBy, changedByEmail, changedAt, recipients }) {
    const intro = `У сайта «${siteName}» изменили адреса, куда приходят уведомления о новых заявках.`
    const rows: [string, string][] = [
      ['Кто', `${changedBy} (${changedByEmail})`],
      ['Когда', `${changedAtFormat.format(new Date(changedAt))} по Москве`],
      [
        'Теперь заявки приходят',
        recipients.length > 0 ? recipients.join(', ') : 'владельцам админки',
      ],
    ]
    const warning =
      'Если смену никто не согласовывал, верните адреса в разделе «Заявки» сайта и смените пароль ' +
      'учётной записи, с которой это сделали: в письмах о заявках — персональные данные посетителей.'
    return {
      subject: `Адреса уведомлений о заявках изменены — ${siteName}`,
      preheader: 'Уведомления о заявках теперь уходят на другие адреса',
      body: html`${paragraph(intro)}${details(rows)}${note(warning)}`,
      text: `${intro}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\n${warning}`,
    }
  },
})
