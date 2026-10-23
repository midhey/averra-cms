import { z } from 'zod'
import { defineBlock } from '../define-block'
import { Image } from '../media'

const Member = z.strictObject({
  name: z.string().trim().min(1).max(80).meta({ title: 'Имя' }),
  role: z.string().trim().max(80).optional().meta({
    title: 'Должность',
    description: 'Чем занимается: «Прораб», «Дизайнер»',
  }),
  photo: Image.optional().meta({
    title: 'Фото',
    description: 'Лучше по пояс и на однотонном фоне. Без фото — пустая плашка',
  }),
})

/** Подписи формы фото для людей: короткие, поэтому в редакторе — сегментами */
const teamPhotoTitles = { portrait: 'Портрет 3 : 4', round: 'Круглое' }

/** Команда: люди с фото, именем и должностью */
export const team = defineBlock({
  type: 'team',
  title: 'Команда',
  description: 'Фото, имя и должность тех, кто будет работать с клиентом',
  category: 'about',
  props: z.strictObject({
    title: z.string().trim().max(120).optional().meta({ title: 'Заголовок' }),
    text: z.string().trim().max(300).optional().meta({ title: 'Текст' }),
    columns: z.literal([2, 3, 4]).default(3).meta({ title: 'Колонок' }),
    photoShape: z
      .enum(['portrait', 'round'])
      .default('portrait')
      .meta({ title: 'Фото', 'x-enum-titles': teamPhotoTitles }),
    members: z.array(Member).min(1).max(24).meta({ title: 'Люди' }),
  }),
  example: {
    title: 'Команда',
    members: [
      { name: '[Имя и фамилия]', role: '[Должность]' },
      { name: '[Имя и фамилия]', role: '[Должность]' },
      { name: '[Имя и фамилия]', role: '[Должность]' },
    ],
  },
})
