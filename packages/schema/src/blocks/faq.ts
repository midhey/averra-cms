import { z } from 'zod'
import { defineBlock } from '../define-block'

const Question = z.strictObject({
  question: z.string().trim().min(1).max(200).meta({ title: 'Вопрос' }),
  answer: z.string().trim().min(1).max(2000).meta({
    title: 'Ответ',
    description: 'Пустая строка — новый абзац',
  }),
})

/**
 * Вопросы и ответы: раскрывающийся список на <details> и <summary> — без JavaScript, с клавиатуры
 * и для диктора. Те же вопросы рендерер кладёт в разметку FAQPage (schema.org) для поисковиков
 */
export const faq = defineBlock({
  type: 'faq',
  title: 'Вопросы и ответы',
  description: 'Раскрывающийся список частых вопросов, работает без JavaScript',
  category: 'trust',
  props: z.strictObject({
    title: z.string().trim().max(120).optional().meta({ title: 'Заголовок' }),
    openFirst: z.boolean().default(true).meta({
      title: 'Первый вопрос открыт',
      description: 'Посетитель сразу видит, что ответы раскрываются',
    }),
    items: z.array(Question).min(1).max(20).meta({ title: 'Вопросы' }),
  }),
  example: {
    title: 'Вопросы и ответы',
    items: [
      { question: 'Сколько стоит выезд на замер?', answer: '[Ответ: цена или «бесплатно»]' },
      {
        question: 'Может ли цена вырасти по ходу работ?',
        answer: '[Ответ: что фиксирует договор]',
      },
      { question: 'Какая гарантия?', answer: '[Ответ: срок и что покрывает гарантия]' },
    ],
  },
})
