import type { z } from 'zod'
import type { SafeHtml } from '../html'

/** Что шаблон собирает из данных. Макет, подвал и проверку темы добавляет renderMail */
export type MailContent = {
  subject: string
  /** Строка рядом с темой в списке писем */
  preheader: string
  /** Тело письма внутри макета */
  body: SafeHtml
  /** Текстовая версия того же письма: её читают клиенты без HTML и спам-фильтры */
  text: string
  /** Куда отвечать: например, посетителю с формы. Проверяется MailAddress */
  replyTo?: string
  /**
   * Своя строка подвала. По умолчанию — «отвечать на него не нужно», а у письма с Reply-To
   * (заявка) это неправда: «Ответить» напишет посетителю
   */
  footer?: string
}

/**
 * Шаблон письма: схема данных и функция, которая из проверенных данных собирает письмо.
 * Данные проверяются схемой при постановке в очередь и ещё раз перед отправкой
 */
export type MailTemplate<S extends z.ZodType = z.ZodType> = {
  id: string
  /** Название в админке */
  title: string
  /** Когда уходит это письмо */
  description: string
  schema: S
  /** Примерные данные: на них админка показывает предпросмотр */
  example: z.input<S>
  /**
   * В данных секрет — одноразовая ссылка с токеном (сброс пароля, приглашение). Тогда данные
   * стираются из очереди не только после отправки, но и после неудачи, а письмо, которое
   * не ушло за lifetimeMs (срок ссылки), не отправляется вовсе и тоже теряет данные
   */
  secret?: { lifetimeMs(data: z.output<S>): number }
  render(data: z.output<S>): MailContent
}

export const defineMailTemplate = <S extends z.ZodType>(template: MailTemplate<S>) => template

/** Склонение по числу: plural(5, ['минуту', 'минуты', 'минут']) → «минут» */
function plural(count: number, [one, few, many]: readonly [string, string, string]) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** Срок в минутах по-человечески: «30 минут», «1 час», «2 часа» */
export function formatMinutes(minutes: number) {
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} ${plural(hours, ['час', 'часа', 'часов'])}`
  }
  return `${minutes} ${plural(minutes, ['минуту', 'минуты', 'минут'])}`
}

export const formatDays = (days: number) => `${days} ${plural(days, ['день', 'дня', 'дней'])}`
