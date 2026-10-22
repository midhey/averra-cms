import type { NotificationMessage } from '../events'

// Сообщение для Telegram с parse_mode HTML. Telegram разбирает в нём только свои теги, а всё
// из данных (что ввёл посетитель, название сайта) экранируется: «<b>» в имени станет текстом,
// а не жирным шрифтом, и не сломает разбор сообщения целиком (тогда Telegram отказал бы с 400)

/**
 * Экранирование для parse_mode HTML. По документации Bot API экранируются ровно эти три символа;
 * кавычек в атрибутах у нас нет — ссылки идут текстом
 */
export const escapeTelegramHtml = (text: string) =>
  text.replace(/[&<>]/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;'))

/**
 * Предел Telegram — 4096 знаков текста после разбора разметки: теги и сущности (&amp;) не в счёт,
 * считаются видимые знаки. Длиннее — Telegram отвечает 400, и это окончательный отказ
 */
export const TELEGRAM_TEXT_LIMIT = 4096
/** Запас на случай, если Telegram посчитает переносы и эмодзи иначе, чем length в JS */
const LIMIT_RESERVE = 64

/**
 * Значения так, чтобы их сумма влезла в budget: короткие — целиком, длинные делят остаток поровну
 * и обрезаются с «…»
 */
export function fitValues(values: readonly string[], budget: number) {
  const order = values.map((value, index) => ({ index, length: value.length }))
  order.sort((a, b) => a.length - b.length)
  const limits = new Array<number>(values.length).fill(0)
  let left = budget
  order.forEach((item, position) => {
    const share = Math.floor(left / (order.length - position))
    const limit = Math.min(item.length, Math.max(share, 0))
    limits[item.index] = limit
    left -= limit
  })
  return values.map((value, index) => {
    const limit = limits[index] ?? 0
    return value.length <= limit ? value : `${value.slice(0, Math.max(limit - 1, 0)).trimEnd()}…`
  })
}

/**
 * Текст сообщения: заголовок жирным, абзацы, поля «Подпись: значение», ссылка текстом (Telegram
 * сам делает её кликабельной, а превью ссылок выключено при отправке)
 */
export function telegramText(message: NotificationMessage) {
  // Значениям полей — всё, что осталось от предела после заголовка, абзацев, подписей и ссылки:
  // посчитано по видимому тексту, тем же порядком и переносами, что ниже
  const fixed = [
    message.title,
    ...message.lines,
    ...(message.fields.length > 0
      ? [message.fields.map((field) => `${field.label}: `).join('\n')]
      : []),
    ...(message.link ? [`${message.link.label}: ${message.link.url}`] : []),
  ].join('\n\n').length
  const values = fitValues(
    message.fields.map((field) => field.value),
    Math.max(TELEGRAM_TEXT_LIMIT - LIMIT_RESERVE - fixed, 0),
  )
  const parts = [
    `<b>${escapeTelegramHtml(message.title)}</b>`,
    ...message.lines.map(escapeTelegramHtml),
  ]
  if (message.fields.length > 0) {
    parts.push(
      message.fields
        .map(
          (field, index) =>
            `<b>${escapeTelegramHtml(field.label)}:</b> ${escapeTelegramHtml(values[index] ?? '')}`,
        )
        .join('\n'),
    )
  }
  if (message.link) {
    parts.push(`${escapeTelegramHtml(message.link.label)}: ${escapeTelegramHtml(message.link.url)}`)
  }
  return parts.join('\n\n')
}
