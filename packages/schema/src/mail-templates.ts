import { z } from 'zod'
import { hasHeaderBreak } from './mail'

const line = z
  .string()
  .max(200, 'Не больше 200 символов')
  .refine(
    (value) => !hasHeaderBreak(value),
    'Нельзя переводить строку и вставлять управляющие символы',
  )

/** Только текст и подстановки: своего HTML у писем нет */
export const MailTemplateText = z.strictObject({
  subject: line.min(1, 'Укажите тему письма'),
  preheader: line,
  body: z.string().min(1, 'Укажите текст письма').max(5000, 'Не больше 5000 символов'),
})
export type MailTemplateText = z.infer<typeof MailTemplateText>
