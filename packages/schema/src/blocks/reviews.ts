import { z } from 'zod'
import { defineBlock } from '../define-block'
import { Image } from '../media'

const Review = z.strictObject({
  quote: z.string().trim().min(1).max(1000).meta({
    title: 'Отзыв',
    description: 'Слова клиента как есть. Пустая строка — новый абзац',
  }),
  name: z.string().trim().min(1).max(80).meta({ title: 'Имя' }),
  caption: z.string().trim().max(120).optional().meta({
    title: 'Подпись',
    description: 'Что делали и когда: «Ремонт двушки, 2026»',
  }),
  photo: Image.optional().meta({ title: 'Фото', description: 'Небольшое круглое фото у имени' }),
})

/**
 * Отзывы: цитаты клиентов с именем, подписью и фото. Разметки Review для поисковиков нет: отзывы
 * о себе на своём сайте поисковики в выдаче не показывают
 */
export const reviews = defineBlock({
  type: 'reviews',
  title: 'Отзывы',
  description: 'Цитаты клиентов с именем, подписью и фото',
  category: 'trust',
  props: z.strictObject({
    title: z.string().trim().max(120).optional().meta({ title: 'Заголовок' }),
    columns: z.literal([1, 2, 3]).default(2).meta({ title: 'Колонок' }),
    items: z.array(Review).min(1).max(12).meta({ title: 'Отзывы' }),
  }),
  example: {
    title: 'Отзывы',
    items: [
      {
        quote: '«[Текст отзыва клиента — как прошла работа и что понравилось]»',
        name: '[Имя клиента]',
        caption: '[Что делали, год]',
      },
      {
        quote: '«[Текст отзыва клиента — про сроки, цену и общение]»',
        name: '[Имя клиента]',
        caption: '[Что делали, год]',
      },
    ],
  },
})
