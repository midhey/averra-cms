import { z } from 'zod'
import { Button } from '../common'
import { defineBlock } from '../define-block'

export const cta = defineBlock({
  type: 'cta',
  title: 'Призыв к действию',
  description: 'Заголовок, пара строк и кнопка — подтолкнуть к следующему шагу',
  category: 'sales',
  props: z.strictObject({
    title: z.string().trim().min(1).max(120).meta({ title: 'Заголовок' }),
    text: z.string().trim().max(300).optional().meta({ title: 'Текст' }),
    button: Button.meta({ title: 'Кнопка' }),
  }),
  example: {
    title: 'Готовы начать?',
    text: 'Оставьте заявку — ответим в течение часа.',
    button: { label: 'Оставить заявку', href: 'mailto:hello@example.com' },
  },
})
