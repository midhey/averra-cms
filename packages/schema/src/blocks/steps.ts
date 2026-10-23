import { z } from 'zod'
import { defineBlock } from '../define-block'

const Step = z.strictObject({
  title: z.string().trim().min(1).max(80).meta({ title: 'Шаг' }),
  text: z.string().trim().max(300).optional().meta({ title: 'Текст' }),
})

/** Как мы работаем: нумерованный список шагов от заявки до результата */
export const steps = defineBlock({
  type: 'steps',
  title: 'Как мы работаем',
  description: 'Шаги от заявки до результата, с номерами по порядку',
  category: 'sales',
  props: z.strictObject({
    title: z.string().trim().max(120).optional().meta({ title: 'Заголовок' }),
    items: z.array(Step).min(3).max(6).meta({ title: 'Шаги' }),
  }),
  example: {
    title: 'Как мы работаем',
    items: [
      { title: 'Заявка', text: '[Как с вами связаться и как быстро вы отвечаете]' },
      { title: 'Расчёт и договор', text: '[Как считаете стоимость и что фиксируете в договоре]' },
      { title: 'Работа', text: '[Как идёт работа и как клиент узнаёт о ходе]' },
      { title: 'Результат', text: '[Как сдаёте работу и что даёте после: гарантию, документы]' },
    ],
  },
})
