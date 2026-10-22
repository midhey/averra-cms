import { z } from 'zod'
import { Href } from '../common'
import { defineBlock } from '../define-block'
import { FORM_MAX_FIELDS, FormField } from '../forms'

/**
 * Форма заявки. Работает без JavaScript: обычная HTML-форма уходит в API, а после приёма браузер
 * возвращается на страницу с якорем #<id>-sent, и CSS показывает текст успеха. Проверка полей
 * в браузере и на сервере — по одной схеме (forms.ts). Ссылка на политику — поле блока и
 * обязательна: без неё форму с персональными данными не сохранить и не опубликовать. Ссылка на
 * текст согласия необязательна: старые формы без неё остаются верными. Пример ссылается на
 * /privacy и /consent — эти адреса создают шаблоны документов (legal.ts)
 */
export const form = defineBlock({
  type: 'form',
  title: 'Форма заявки',
  description:
    'Заявка с сайта без JavaScript: поля, согласие на обработку данных, уведомление на почту',
  props: z
    .strictObject({
      title: z.string().trim().min(1).max(120).meta({ title: 'Заголовок' }),
      text: z.string().trim().max(500).optional().meta({ title: 'Текст' }),
      fields: z.array(FormField).min(1).max(FORM_MAX_FIELDS).meta({ title: 'Поля' }),
      submitLabel: z
        .string()
        .trim()
        .min(1)
        .max(40)
        .default('Отправить заявку')
        .meta({ title: 'Текст кнопки' }),
      successText: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .default('Спасибо! Заявка отправлена, мы скоро свяжемся с вами.')
        .meta({ title: 'Текст после отправки' }),
      consentText: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .default('Я согласен на обработку персональных данных')
        .meta({
          title: 'Текст согласия',
          description: 'Рядом с флажком согласия; ссылка на политику встанет после него',
        }),
      policyUrl: Href.meta({
        title: 'Ссылка на политику конфиденциальности',
        description: 'Страница политики обработки персональных данных: /privacy или https://…',
      }),
      consentUrl: Href.optional().meta({
        title: 'Ссылка на текст согласия',
        description:
          'Согласие на обработку персональных данных — отдельный документ (152-ФЗ): /consent или https://…',
      }),
    })
    .superRefine((props, ctx) => {
      const seen = new Set<string>()
      props.fields.forEach((field, index) => {
        if (seen.has(field.name)) {
          ctx.addIssue({
            code: 'custom',
            path: ['fields', index, 'name'],
            message: `Ключ «${field.name}» уже есть у другого поля формы`,
          })
        }
        seen.add(field.name)
      })
    }),
  example: {
    title: 'Оставьте заявку',
    text: 'Перезвоним в течение часа в рабочее время.',
    fields: [
      { name: 'name', type: 'name', label: 'Имя', required: true },
      {
        name: 'phone',
        type: 'phone',
        label: 'Телефон',
        required: true,
        hint: 'Например, +7 900 123-45-67',
      },
      { name: 'email', type: 'email', label: 'Почта', hint: 'Пришлём подтверждение заявки' },
      { name: 'comment', type: 'textarea', label: 'Комментарий' },
    ],
    policyUrl: '/privacy',
    consentUrl: '/consent',
  },
})
