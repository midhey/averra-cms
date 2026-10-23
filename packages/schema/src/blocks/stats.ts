import { z } from 'zod'
import { defineBlock } from '../define-block'

const StatItem = z.strictObject({
  value: z.string().trim().min(1).max(16).meta({
    title: 'Число',
    description: 'Крупно: «12», «340», «3 года», «0 ₽»',
  }),
  label: z.string().trim().min(1).max(80).meta({
    title: 'Подпись',
    description: 'Что это за число: «лет работаем в Перми»',
  }),
})

/** Подписи оформления для людей: короткие, поэтому в редакторе — сегментами */
const statsToneTitles = { surface: 'На подложке', plain: 'Без подложки' }

/**
 * Цифры: пара фактов крупно. Числа — акцентом и на подложке: это крупный текст, ему хватает
 * порога 3, а акцент и на фоне, и на поверхности тема проверяет строго
 */
export const stats = defineBlock({
  type: 'stats',
  title: 'Цифры',
  description: 'Пара фактов крупно: сколько лет работаете, сколько объектов, какая гарантия',
  category: 'trust',
  props: z.strictObject({
    title: z.string().trim().max(120).optional().meta({ title: 'Заголовок' }),
    tone: z
      .enum(['surface', 'plain'])
      .default('surface')
      .meta({ title: 'Оформление', 'x-enum-titles': statsToneTitles }),
    items: z.array(StatItem).min(2).max(4).meta({ title: 'Факты' }),
  }),
  example: {
    items: [
      { value: '[12]', label: 'лет работаем' },
      { value: '[340]', label: 'объектов сдали' },
      { value: '[3 года]', label: 'гарантия по договору' },
    ],
  },
})
