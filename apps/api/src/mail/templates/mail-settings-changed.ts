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
 * Настройки SMTP поменяли или удалили в админке. Уходит каждому владельцу через очередь — уже
 * по новым настройкам (src/mail/runtime.ts). Значений полей и пароля в письме нет: только что
 * поменялось и через что теперь уходят письма
 */
export const mailSettingsChangedTemplate = defineMailTemplate({
  id: 'mail-settings-changed',
  title: 'Настройки почты изменены',
  description:
    'Уходит всем владельцам, когда настройки SMTP сохраняют или удаляют на странице «Почта»',
  schema: z.strictObject({
    changedBy: MailLine(100),
    changedByEmail: MailAddress,
    changedAt: z.iso.datetime({ offset: true }),
    // saved — сохранили (заданы впервые или поменяли), removed — удалили из админки
    action: z.enum(['saved', 'removed']),
    // Что поменялось, словами: «сервер», «пароль»…
    fields: z.array(MailLine(60)).max(10),
    // Через что теперь уходят письма, без пароля: «SMTP smtp.yandex.ru:465 (TLS)…»
    provider: MailLine(300),
    // Прошла ли проверка подключения перед сохранением
    verified: z.boolean(),
  }),
  example: {
    changedBy: 'Анна',
    changedByEmail: 'anna@example.ru',
    changedAt: '2026-10-15T09:30:00.000Z',
    action: 'saved',
    fields: ['сервер', 'пароль'],
    provider: 'SMTP smtp.example.ru:465 (TLS), вход noreply@example.ru',
    verified: true,
  },
  render({ changedBy, changedByEmail, changedAt, action, fields, provider, verified }) {
    const when = `${changedAtFormat.format(new Date(changedAt))} по Москве`
    const intro =
      action === 'saved'
        ? 'Настройки почты в админке Averra CMS изменены.'
        : 'Настройки SMTP удалены из админки Averra CMS.'
    const rows: [string, string][] = [
      ['Кто', `${changedBy} (${changedByEmail})`],
      ['Когда', when],
    ]
    if (action === 'saved') {
      rows.push(['Что изменено', fields.length > 0 ? fields.join(', ') : 'ничего'])
      rows.push([
        'Проверка подключения',
        verified ? 'пройдена перед сохранением' : 'не делалась: сохранено без проверки',
      ])
    }
    rows.push(['Теперь письма уходят', provider])
    const warning =
      'Если это были не вы, сразу смените пароль от админки и проверьте настройки на странице ' +
      '«Почта»: через почту уходят ссылки сброса пароля.'
    return {
      subject: 'Настройки почты Averra CMS изменены',
      preheader:
        action === 'saved'
          ? 'Настройки SMTP изменены в админке'
          : 'Настройки SMTP удалены из админки',
      body: html`${paragraph(intro)}${details(rows)}${note(warning)}`,
      text: `${intro}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\n${warning}`,
    }
  },
})
