import { MailAddress, MailLine, MailUrl } from '@averra/schema'
import { z } from 'zod'
import { html } from '../html'
import { button, fieldTable, note, paragraph } from '../layout'
import { defineMailTemplate } from './define'

const createdAtFormat = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Moscow',
})

/**
 * Новая заявка с формы сайта — владельцу или менеджеру (адреса из настроек заявок сайта).
 * Ставит в очередь приём заявки (modules/leads/service.ts) в той же транзакции, что и заявку.
 * Всё, что ввёл посетитель, только подставляется в html`…` и экранируется. Тема собрана из
 * названия сайта — его задаёт студия, а не посетитель. Reply-To — почта посетителя, если он
 * её указал: она прошла MailAddress в схеме формы и проходит ещё раз в renderMail
 */
export const leadNewTemplate = defineMailTemplate({
  id: 'lead-new',
  title: 'Новая заявка',
  description:
    'Уходит на адреса уведомлений сайта (по умолчанию — владельцам), когда посетитель отправил форму',
  schema: z.strictObject({
    siteName: MailLine(80),
    formTitle: MailLine(120),
    // Адрес страницы на сайте: «/» или «/o-nas»
    pagePath: MailLine(70),
    // Подписи полей формы и что ввёл посетитель. Многострочное значение сохраняет переводы строк
    fields: z
      .array(z.strictObject({ label: MailLine(80), value: z.string().max(2000) }))
      .min(1)
      .max(12),
    createdAt: z.iso.datetime({ offset: true }),
    // Заявка в админке
    url: MailUrl,
    replyTo: MailAddress.optional(),
  }),
  example: {
    siteName: 'Ремонт квартир под ключ',
    formTitle: 'Оставьте заявку',
    pagePath: '/',
    fields: [
      { label: 'Имя', value: 'Анна' },
      { label: 'Телефон', value: '+7 900 123-45-67' },
      { label: 'Почта', value: 'anna@example.ru' },
      { label: 'Комментарий', value: 'Нужен ремонт ванной.\nУдобно звонить после 18:00.' },
    ],
    createdAt: '2026-10-15T09:30:00.000Z',
    url: 'https://admin.example.ru/sites/d0000000-0000-4000-8000-000000000001/leads/example',
    replyTo: 'anna@example.ru',
  },
  render({ siteName, formTitle, pagePath, fields, createdAt, url, replyTo }) {
    const when = `${createdAtFormat.format(new Date(createdAt))} по Москве`
    const intro = `Новая заявка с сайта «${siteName}»: форма «${formTitle}» на странице ${pagePath}.`
    const rows = fields.map(({ label, value }) => [label, value === '' ? '—' : value] as const)
    const reply = replyTo
      ? `Посетитель оставил почту ${replyTo}: «Ответить» в почте напишет ему.`
      : 'Почту посетитель не оставил: ответить можно по контактам из заявки.'
    const text = [
      intro,
      `Когда: ${when}`,
      '',
      ...rows.map(([label, value]) => `${label}: ${value.replaceAll('\n', '\n  ')}`),
      '',
      reply,
      `Заявка в админке: ${url}`,
    ].join('\n')
    return {
      subject: `Новая заявка с сайта «${siteName}»`,
      preheader: `Форма «${formTitle}», ${when}`,
      body: html`${paragraph(intro)}${note(`Когда: ${when}`)}${fieldTable(rows)}${paragraph(reply)}${button('Открыть заявку в админке', url)}`,
      text,
      ...(replyTo === undefined ? {} : { replyTo }),
      footer: replyTo
        ? 'Averra CMS · уведомление о заявке с сайта. «Ответить» напишет посетителю'
        : 'Averra CMS · уведомление о заявке с сайта, отправлено автоматически',
    }
  },
})
