import { MailLine, MailUrl } from '@averra/schema'
import { z } from 'zod'
import { html } from '../html'
import { button, fieldTable, paragraph } from '../layout'
import { defineMailTemplate } from './define'

/**
 * Пределы общего «Уведомления». Сообщение события под них подгоняет renderNotification
 * (src/notifications/events.ts): длинное название сайта не должно ронять письмо, а с ним — весь
 * круг служебных уведомлений
 */
export const NOTIFICATION_LIMITS = {
  title: 200,
  line: 1000,
  lines: 10,
  label: 80,
  value: 2000,
  fields: 20,
} as const

/**
 * Уведомление модуля уведомлений по почте (src/notifications): служебные события установки
 * и всё, у чего нет своего шаблона. Сообщение нейтральное — заголовок, абзацы, поля, ссылка, —
 * его же рисуют другие каналы (Telegram). Всё из данных только подставляется в html`…`
 */
export const notificationTemplate = defineMailTemplate({
  id: 'notification',
  title: 'Уведомление',
  description:
    'Служебные уведомления установки (бэкап, диск, сборка) и проверка канала из раздела «Уведомления»',
  schema: z.strictObject({
    title: MailLine(NOTIFICATION_LIMITS.title),
    lines: z.array(z.string().min(1).max(NOTIFICATION_LIMITS.line)).max(NOTIFICATION_LIMITS.lines),
    fields: z
      .array(
        z.strictObject({
          label: MailLine(NOTIFICATION_LIMITS.label),
          value: z.string().max(NOTIFICATION_LIMITS.value),
        }),
      )
      .max(NOTIFICATION_LIMITS.fields),
    link: z.strictObject({ label: MailLine(NOTIFICATION_LIMITS.label), url: MailUrl }).optional(),
  }),
  example: {
    title: 'Ремонт квартир: бэкап не прошёл',
    lines: [
      'Последний бэкап установки не удался. Данные после прошлого удачного бэкапа не защищены.',
    ],
    fields: [
      { label: 'Бэкап', value: '20261015-030000-scheduled' },
      { label: 'Причина', value: 'не хватило места на диске' },
    ],
    link: { label: 'Состояние установки', url: 'https://admin.example.ru/status' },
  },
  render({ title, lines, fields, link }) {
    const rows = fields.map(({ label, value }) => [label, value === '' ? '—' : value] as const)
    const text = [
      ...lines,
      ...(rows.length > 0 ? ['', ...rows.map(([label, value]) => `${label}: ${value}`)] : []),
      ...(link ? ['', `${link.label}: ${link.url}`] : []),
    ].join('\n')
    return {
      subject: title,
      preheader: lines[0] ?? title,
      body: html`${lines.map((line) => paragraph(line))}${rows.length > 0 ? fieldTable(rows) : ''}${link ? button(link.label, link.url) : ''}`,
      text: text === '' ? title : text,
    }
  },
})
