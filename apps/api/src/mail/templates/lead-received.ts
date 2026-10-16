import { MailLine } from '@averra/schema'
import { z } from 'zod'
import { html } from '../html'
import { note, paragraph } from '../layout'
import { defineMailTemplate } from './define'

/**
 * Подтверждение посетителю, что заявка получена. Текст фиксированный: в данных только название
 * сайта, которое задаёт студия. Ни имени, ни других полей посетителя здесь нет и быть не может
 * (схема строгая): иначе форму превратили бы в рассылку своего текста на чужие адреса.
 * Уходит только после антиспама, только если посетитель указал почту и не чаще раза в сутки
 * на адрес с сайта (modules/leads/service.ts)
 */
export const leadReceivedTemplate = defineMailTemplate({
  id: 'lead-received',
  title: 'Заявка получена',
  description:
    'Уходит посетителю, который оставил почту в форме, — не чаще раза в сутки на адрес; на сайте можно выключить',
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
