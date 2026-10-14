// HTML писем без шаблонизатора и без React: тег html`…` экранирует каждую подстановку.
// Без экранирования вставляется только то, что собрал сам html`…`, — так в письмо
// не попадает сырой HTML из данных (имя, название сайта, ссылка)

const SAFE = Symbol('безопасный HTML')

/** Фрагмент HTML, который собрал html`…`: его подставляют как есть */
export type SafeHtml = { readonly [SAFE]: true; readonly value: string }

const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Экранирует текст для HTML: и для содержимого, и для значения атрибута в кавычках */
export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => escapes[char] ?? char)

const isSafe = (value: unknown): value is SafeHtml =>
  typeof value === 'object' && value !== null && SAFE in value

type Part = string | number | SafeHtml | null | undefined | false | readonly Part[]

function render(part: Part): string {
  if (part === null || part === undefined || part === false) return ''
  if (Array.isArray(part)) return part.map(render).join('')
  if (isSafe(part)) return part.value
  return escapeHtml(String(part))
}

/** html`<p>${имя}</p>` — подстановки экранируются, вложенные html`…` и их массивы — нет */
export function html(strings: TemplateStringsArray, ...parts: Part[]): SafeHtml {
  let value = strings[0] ?? ''
  parts.forEach((part, index) => {
    value += render(part) + (strings[index + 1] ?? '')
  })
  return { [SAFE]: true, value }
}
