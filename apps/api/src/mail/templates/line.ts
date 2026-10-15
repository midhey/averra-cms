// biome-ignore lint/suspicious/noControlCharactersInRegex: ищем именно управляющие символы
const BREAKS = /[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g

/**
 * Строка из базы для данных шаблона, которые проверяет MailLine: имя пользователя, название
 * сайта. Переводы строк и управляющие символы становятся пробелом, лишние пробелы схлопываются,
 * длинное обрезается до max. Так имя, заведённое когда-то с переводом строки, не ломает письмо
 * сброса пароля. Пустое после чистки — fallback
 */
export function toMailLine(value: string, max: number, fallback: string) {
  const line = value.replace(BREAKS, ' ').replace(/\s+/g, ' ').trim()
  if (line.length === 0) return fallback
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}
