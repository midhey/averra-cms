import { z } from 'zod'

// Разрешаем только безопасные начала ссылок: javascript: в href — прямой путь к XSS
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/|#)/i

export const Href = z
  .string()
  .trim()
  .max(2048)
  .regex(SAFE_HREF, 'Ссылка должна начинаться с https://, http://, /, #, mailto: или tel:')

export const Button = z.strictObject({
  label: z.string().trim().min(1).max(40).meta({ title: 'Текст кнопки' }),
  href: Href.meta({ title: 'Ссылка' }),
})
