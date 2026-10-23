import { z } from 'zod'
import { Button } from '../common'
import { defineBlock } from '../define-block'

const Plan = z.strictObject({
  name: z.string().trim().min(1).max(60).meta({ title: 'Название' }),
  price: z.string().trim().min(1).max(40).meta({
    title: 'Цена',
    description: 'Как на сайте: «от 4 500 ₽/м²», «по смете», «12 000 ₽»',
  }),
  features: z
    .array(z.string().trim().min(1).max(120).meta({ title: 'Пункт' }))
    .max(10)
    .default([])
    .meta({ title: 'Что входит' }),
  featured: z.boolean().default(false).meta({
    title: 'Выделить',
    description: 'Рамка акцентом и подпись над названием. Выделить можно один тариф',
  }),
  button: Button.optional().meta({ title: 'Кнопка' }),
})

/**
 * Услуги и цены: тарифы карточками, один можно выделить. Цена — строка, а не число: «от … ₽/м²»,
 * «по смете» и диапазоны пишут как есть
 */
export const pricing = defineBlock({
  type: 'pricing',
  title: 'Услуги и цены',
  description: 'Тарифы карточками: цена, что входит и кнопка, один можно выделить',
  category: 'sales',
  props: z
    .strictObject({
      title: z.string().trim().max(120).optional().meta({ title: 'Заголовок' }),
      text: z.string().trim().max(300).optional().meta({ title: 'Текст' }),
      featuredLabel: z.string().trim().min(1).max(30).default('Чаще выбирают').meta({
        title: 'Подпись выделенного тарифа',
      }),
      plans: z.array(Plan).min(2).max(4).meta({ title: 'Тарифы' }),
    })
    // Путь — флажок второго выделенного: ошибка встанет у него в редакторе
    .superRefine((props, ctx) => {
      let featured = 0
      props.plans.forEach((plan, index) => {
        if (!plan.featured) return
        featured += 1
        if (featured > 1) {
          ctx.addIssue({
            code: 'custom',
            path: ['plans', index, 'featured'],
            message: 'Выделить можно один тариф: снимите флажок у другого',
          })
        }
      })
    }),
  example: {
    title: 'Услуги и цены',
    text: '[Что входит в цену и что считается отдельно]',
    plans: [
      {
        name: 'Косметический',
        price: 'от [цена] ₽/м²',
        features: ['[Что входит]', '[Что входит]', 'Срок от [N] недель'],
        button: { label: 'Обсудить', href: '#contact' },
      },
      {
        name: 'Капитальный',
        price: 'от [цена] ₽/м²',
        features: ['[Что входит]', '[Что входит]', 'Срок от [N] недель'],
        featured: true,
        button: { label: 'Обсудить', href: '#contact' },
      },
      {
        name: 'Под ключ',
        price: 'от [цена] ₽/м²',
        features: ['[Что входит]', '[Что входит]', 'Срок от [N] недель'],
        button: { label: 'Обсудить', href: '#contact' },
      },
    ],
  },
})
