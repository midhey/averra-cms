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

/**
 * Шаблон адреса почты — строка для HTML-атрибута pattern (браузер собирает его как ^(?:…)$
 * с флагом v) и для сервера: так форма на сайте и API принимают одно и то же.
 * Имя ящика — латиница, цифры и _ ' + -, точки только между ними. Запятых, кавычек, угловых
 * скобок и пробелов нет — адрес не разобрать как несколько и не вставить в заголовок своё.
 * Домен — буквы любого алфавита и цифры: anna@пример.рф и его punycode
 * (anna@xn--e1afmkfd.xn--p1ai — так IDN отправляет Chrome). Зона — не короче двух знаков
 * и начинается с буквы. Кириллический домен nodemailer сам переводит в punycode при отправке
 */
export const MAIL_ADDRESS_PATTERN = String.raw`[A-Za-z0-9_'\+\-]+(?:\.[A-Za-z0-9_'\+\-]+)*@(?:[\p{L}\p{N}](?:[\p{L}\p{N}\-]*[\p{L}\p{N}])?\.)+\p{L}[\p{L}\p{N}\-]*[\p{L}\p{N}]`

const MAIL_ADDRESS_REGEXP = new RegExp(`^(?:${MAIL_ADDRESS_PATTERN})$`, 'v')

/** Адрес почты для заголовков письма: получатель, отправитель, Reply-To */
export const MailAddress = singleLine().pipe(
  z.string().max(254).regex(MAIL_ADDRESS_REGEXP, 'Нужен адрес почты, например anna@example.ru'),
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
