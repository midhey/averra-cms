import { z } from 'zod'
import { defineBlock } from '../define-block'
import { Image } from '../media'

const Photo = z.strictObject({
  image: Image.optional().meta({
    title: 'Фото',
    description: 'Без фото на его месте пустая плашка: видно, куда его поставить',
  }),
  caption: z.string().trim().max(120).optional().meta({
    title: 'Подпись',
    description: 'Что за работа: «Двушка на Ленина, 54 м²»',
  }),
})

/** Подписи кадра для людей: короткие, поэтому в редакторе — сегментами */
const galleryAspectTitles = { landscape: '4 : 3', square: 'Квадрат', original: 'Как есть' }

/**
 * Наши работы: сетка фото с подписями. Без JavaScript лайтбокса нет — фото может быть ссылкой на
 * самый большой вариант, браузер откроет его сам
 */
export const gallery = defineBlock({
  type: 'gallery',
  title: 'Наши работы',
  description: 'Галерея фото с подписями: готовые объекты, до и после',
  category: 'trust',
  props: z.strictObject({
    title: z.string().trim().max(120).optional().meta({ title: 'Заголовок' }),
    text: z.string().trim().max(300).optional().meta({ title: 'Текст' }),
    columns: z.literal([2, 3, 4]).default(3).meta({ title: 'Колонок' }),
    aspect: z.enum(['landscape', 'square', 'original']).default('landscape').meta({
      title: 'Кадр',
      description: 'Фото обрезаются до одной формы — сетка ровнее. «Как есть» — без обрезки',
      'x-enum-titles': galleryAspectTitles,
    }),
    linkToFull: z.boolean().default(true).meta({
      title: 'Открывать фото целиком',
      description: 'Фото — ссылка на снимок в полном размере',
    }),
    items: z.array(Photo).min(1).max(24).meta({ title: 'Фото' }),
  }),
  example: {
    title: 'Наши работы',
    items: [
      { caption: '[Что за объект, площадь]' },
      { caption: '[Что за объект, площадь]' },
      { caption: '[Что за объект, площадь]' },
    ],
  },
})
