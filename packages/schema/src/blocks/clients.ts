import { z } from 'zod'
import { defineBlock } from '../define-block'
import { Logo } from '../media'

const Client = z.strictObject({
  name: z.string().trim().min(1).max(80).meta({
    title: 'Название',
    description: 'Его прочтёт экранный диктор вместо логотипа, а без логотипа оно стоит текстом',
  }),
  logo: Logo.optional().meta({
    title: 'Логотип',
    description: 'PNG, WebP или SVG из медиатеки, лучше на прозрачном фоне',
  }),
})

/** Подписи оформления для людей: короткие, поэтому в редакторе — сегментами */
const clientsToneTitles = { color: 'В цвете', mono: 'Серые' }

/** Клиенты: ряд логотипов. Логотип может быть SVG — единственное место в блоках, где он нужен */
export const clients = defineBlock({
  type: 'clients',
  title: 'Клиенты',
  description: 'Ряд логотипов компаний, с которыми вы работали',
  category: 'trust',
  props: z.strictObject({
    title: z.string().trim().max(120).optional().meta({ title: 'Заголовок' }),
    tone: z.enum(['color', 'mono']).default('color').meta({
      title: 'Цвет логотипов',
      description:
        'Серые — спокойнее, когда логотипы разных цветов. На тёмной теме тёмный логотип и серым останется тёмным — загрузите его светлый вариант',
      'x-enum-titles': clientsToneTitles,
    }),
    items: z.array(Client).min(2).max(24).meta({ title: 'Клиенты' }),
  }),
  example: {
    title: 'Нам доверяют',
    items: [
      { name: '[Название клиента]' },
      { name: '[Название клиента]' },
      { name: '[Название клиента]' },
      { name: '[Название клиента]' },
    ],
  },
})
