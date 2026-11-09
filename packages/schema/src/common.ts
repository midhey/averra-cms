import { z } from 'zod'

// Разрешаем только безопасные начала ссылок: javascript: в href — прямой путь к XSS
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/|#)/i

export const Href = z
  .string()
  .trim()
  .max(2048)
  .regex(SAFE_HREF, 'Ссылка должна начинаться с https://, http://, /, #, mailto: или tel:')

/**
 * Кнопка-ссылка. window — открыть страницу по ссылке окном поверх этой (форма заявки, свои блоки):
 * работает, если та страница настроена как окно; без JS и Ctrl-кликом — обычный переход на неё
 * (Решения → Окна и поведения). Нет значения — обычная ссылка
 */
export const Button = z.strictObject({
  label: z.string().trim().min(1).max(40).meta({ title: 'Текст кнопки' }),
  href: Href.meta({ title: 'Ссылка' }),
  window: z.boolean().optional().meta({
    title: 'Открывать в окне',
    description:
      'Если страница по ссылке — окно (SEO страницы → «Окно»): откроется поверх этой. Без JavaScript — переход на неё',
  }),
})

/**
 * Появление при прокрутке у встроенных блоков: карточки въезжают снизу или проявляются, когда до
 * них долистали. Без JS и при «уменьшить движение» в системе всё видно сразу (скрипт поведений)
 */
export const Reveal = z.enum(['none', 'up', 'fade'])
export type Reveal = z.infer<typeof Reveal>
export const revealTitles: Record<Reveal, string> = {
  none: 'Нет',
  up: 'Снизу',
  fade: 'Проявление',
}
/** Поле «Появление при прокрутке» блока: нет значения — без анимации */
export const revealField = () =>
  Reveal.optional().meta({
    title: 'Появление при прокрутке',
    description: 'Карточки появляются, когда до них долистали. Без JavaScript видны сразу',
    'x-enum-titles': revealTitles,
  })
