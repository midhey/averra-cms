import { MailLine } from '@averra/schema'
import { z } from 'zod'
import { html } from '../html'
import { note, paragraph } from '../layout'
import { defineMailTemplate } from './define'

/**
 * Подтверждение посетителю: данные содержат только название сайта, без полей заявки.
 * Уходит только после антиспама, только если посетитель указал почту и не чаще раза в сутки
 * на адрес с сайта (modules/leads/service.ts)
 */
export const leadReceivedTemplate = defineMailTemplate({
  id: 'lead-received',
  title: 'Заявка получена',
  description:
    'Уходит посетителю, который оставил почту в форме, — не чаще раза в сутки на адрес; на сайте можно выключить',
  scope: 'site',
  vars: { siteName: { label: 'Название сайта', value: ({ siteName }) => siteName } },
  blocks: {},
  defaultText: {
    subject: 'Заявка получена — {siteName}',
    preheader: 'Мы получили вашу заявку и скоро свяжемся с вами',
    body: 'Здравствуйте!\n\nМы получили вашу заявку на сайте «{siteName}» и скоро с вами свяжемся.\n\n> Если вы не оставляли заявку, просто удалите это письмо: больше писем без вашей заявки не будет.',
  },
  schema: z.strictObject({ siteName: MailLine(80) }),
  example: { siteName: 'Ремонт квартир под ключ' },
  render({ siteName }) {
    const intro = `Мы получили вашу заявку на сайте «${siteName}» и скоро с вами свяжемся.`
    const ignore =
      'Если вы не оставляли заявку, просто удалите это письмо: больше писем без вашей заявки не будет.'
    return {
      subject: `Заявка получена — ${siteName}`,
      preheader: 'Мы получили вашу заявку и скоро свяжемся с вами',
      body: html`${paragraph('Здравствуйте!')}${paragraph(intro)}${note(ignore)}`,
      text: `Здравствуйте!\n\n${intro}\n\n${ignore}`,
    }
  },
})
