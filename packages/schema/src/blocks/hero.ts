import { z } from 'zod'
import { Button } from '../common'
import { defineBlock } from '../define-block'

export const hero = defineBlock({
  type: 'hero',
  title: 'Первый экран',
  props: z.strictObject({
    // Вариант с картинкой сбоку появится вместе с модулем медиа
    variant: z.enum(['centered', 'left']).default('centered').meta({ title: 'Вариант' }),
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .meta({ title: 'Заголовок', description: 'Главная мысль страницы' }),
    subtitle: z.string().trim().max(300).optional().meta({ title: 'Подзаголовок' }),
    button: Button.optional().meta({ title: 'Кнопка' }),
  }),
  example: {
    title: 'Главная мысль страницы',
    subtitle: 'Одно-два предложения о том, чем вы полезны клиенту.',
    button: { label: 'Оставить заявку', href: '#contact' },
  },
})
