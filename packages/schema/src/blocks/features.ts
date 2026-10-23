import { z } from 'zod'
import { defineBlock } from '../define-block'

const FeatureItem = z.strictObject({
  title: z.string().trim().min(1).max(80).meta({ title: 'Заголовок' }),
  text: z.string().trim().max(300).optional().meta({ title: 'Текст' }),
})

export const features = defineBlock({
  type: 'features',
  title: 'Преимущества',
  description: 'Сетка коротких пунктов: почему выбирают вас',
  category: 'about',
  props: z.strictObject({
    title: z.string().trim().max(120).optional().meta({ title: 'Заголовок' }),
    columns: z.literal([2, 3, 4]).default(3).meta({ title: 'Колонок' }),
    items: z.array(FeatureItem).min(1).max(12).meta({ title: 'Пункты' }),
  }),
  example: {
    title: 'Почему выбирают нас',
    items: [
      { title: 'Первое преимущество', text: 'Коротко о том, чем оно полезно клиенту.' },
      { title: 'Второе преимущество', text: 'Коротко о том, чем оно полезно клиенту.' },
      { title: 'Третье преимущество', text: 'Коротко о том, чем оно полезно клиенту.' },
    ],
  },
})
