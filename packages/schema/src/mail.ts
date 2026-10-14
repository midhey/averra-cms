import { z } from 'zod'

// Всё, что попадает в заголовки письма (адреса, тема, имя отправителя), — одна строка.
// Перевод строки в заголовке начинает новый заголовок: так подставляют свой Bcc или тело
// письма (header injection). Поэтому такие символы не вычищаем молча, а отклоняем

// biome-ignore lint/suspicious/noControlCharactersInRegex: ищем именно управляющие символы
const HEADER_BREAK = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/

/** Есть ли в строке перевод строки или другой управляющий символ */
export const hasHeaderBreak = (value: string) => HEADER_BREAK.test(value)

const BREAK_MESSAGE = 'Нельзя переводить строку и вставлять управляющие символы'

/** Однострочная строка без управляющих символов. Пробелы по краям обрезаются уже после проверки */
const singleLine = () =>
  z
    .string()
    .refine((value) => !hasHeaderBreak(value), BREAK_MESSAGE)
    .trim()

/** Адрес почты для заголовков письма: получатель, отправитель, Reply-To */
export const MailAddress = singleLine().pipe(
  z.email('Нужен адрес почты, например anna@example.ru').max(254),
)
export type MailAddress = z.infer<typeof MailAddress>

/** Тема письма */
export const MailSubject = singleLine().pipe(z.string().min(1).max(200))

/** Имя отправителя: «Averra CMS» в «Averra CMS <noreply@…>» */
export const MailSenderName = singleLine().pipe(z.string().min(1).max(100))

/**
 * Однострочный текст в данных шаблона: имя, название сайта. Он может попасть в тему письма,
 * поэтому переводы строк в нём запрещены так же, как в заголовках
 */
export const MailLine = (max = 200) => singleLine().pipe(z.string().min(1).max(max))

/**
 * Ссылка в письме: только http(s). javascript: и data: в письме — путь к фишингу и XSS
 * в веб-почте, а других ссылок системе слать незачем
 */
export const MailUrl = z.url({
  protocol: /^https?$/,
  error: 'Нужна ссылка, которая начинается с http:// или https://',
})
