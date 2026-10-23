import { z } from 'zod'
import { defineBlock } from '../define-block'

/** Сколько символов в тексте блока: хватает на раздел политики конфиденциальности */
export const TEXT_BODY_MAX = 20_000

/**
 * Текст: заголовок и абзацы — условия, подробности, политика конфиденциальности. Разметка —
 * лёгкая (text-body.ts), без HTML: так блок не сломает страницу и не протащит скрипт
 */
export const text = defineBlock({
  type: 'text',
  title: 'Текст',
  description: 'Заголовок и абзацы текста: подробности, условия, политика конфиденциальности',
  category: 'about',
  props: z.strictObject({
    title: z.string().trim().max(120).optional().meta({ title: 'Заголовок' }),
    body: z.string().trim().min(1).max(TEXT_BODY_MAX).meta({
      title: 'Текст',
      description:
        'Пустая строка — новый абзац. Строка с «- » — пункт списка, строка с «## » — подзаголовок',
    }),
  }),
  example: {
    title: 'Как мы работаем',
    body: 'Приезжаем на замер в удобное время и через день присылаем смету.\n\n- Договор с фиксированной ценой\n- Оплата по этапам\n- Гарантия 3 года',
  },
})
