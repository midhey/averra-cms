import { html, type SafeHtml } from './html'

// Оформление писем системы — нейтральное, в стиле Averra CMS. Почтовые клиенты не понимают
// нормальный CSS (Gmail режет <style>, Outlook рисует движком Word), поэтому вёрстка на
// таблицах и только инлайн-стили. Шрифты системные: внешних запросов в письме нет

export const mailColors = {
  page: '#f4f5f7',
  card: '#ffffff',
  border: '#e3e5e9',
  text: '#1f2430',
  muted: '#5b6170',
  accent: '#2f5bea',
  onAccent: '#ffffff',
} as const

// Константа нашего же кода, поэтому собрана html`…` и не экранируется (в ней кавычки)
const FONT = html`-apple-system, 'Segoe UI', Roboto, Arial, sans-serif`

/** Абзац основного текста */
export const paragraph = (content: SafeHtml | string) =>
  html`<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${mailColors.text}">${content}</p>`

/** Мелкий серый текст: пояснения, срок действия ссылки */
export const note = (content: SafeHtml | string) =>
  html`<p style="margin:0 0 12px;font-family:${FONT};font-size:14px;line-height:20px;color:${mailColors.muted}">${content}</p>`

/**
 * Кнопка-ссылка и сама ссылка текстом под ней: кнопку режут некоторые клиенты, а ссылку
 * можно скопировать. Адрес уже прошёл MailUrl (только http/https) и здесь экранируется
 */
export const button = (
  label: string,
  url: string,
) => html`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px">
  <tr>
    <td style="border-radius:6px;background:${mailColors.accent}">
      <a href="${url}" style="display:inline-block;padding:12px 20px;font-family:${FONT};font-size:16px;font-weight:600;line-height:20px;color:${mailColors.onAccent};text-decoration:none;border-radius:6px">${label}</a>
    </td>
  </tr>
</table>
${note(html`Если кнопка не открывается, скопируйте ссылку в браузер:<br><a href="${url}" style="color:${mailColors.accent};word-break:break-all">${url}</a>`)}`

/** Таблица «подпись — значение» */
export const details = (
  rows: readonly (readonly [string, string])[],
) => html`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;border-collapse:collapse">
  ${rows.map(
    ([label, value]) => html`<tr>
    <td style="padding:6px 12px 6px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${mailColors.muted};white-space:nowrap;vertical-align:top">${label}</td>
    <td style="padding:6px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${mailColors.text}">${value}</td>
  </tr>`,
  )}
</table>`

export const MAIL_FOOTER = 'Averra CMS · письмо отправлено автоматически, отвечать на него не нужно'

/**
 * Документ письма целиком. preheader — строка, которую почтовый клиент показывает в списке
 * писем рядом с темой; в самом письме она скрыта
 */
export function mailLayout({
  subject,
  preheader,
  body,
}: {
  subject: string
  preheader: string
  body: SafeHtml
}) {
  return html`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${mailColors.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${mailColors.page}">
  <tr>
    <td align="center" style="padding:24px 12px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px">
        <tr>
          <td style="padding:0 4px 12px;font-family:${FONT};font-size:14px;font-weight:700;letter-spacing:0.02em;color:${mailColors.text}">Averra CMS</td>
        </tr>
        <tr>
          <td style="padding:28px 28px 12px;background:${mailColors.card};border:1px solid ${mailColors.border};border-radius:8px">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding:12px 4px;font-family:${FONT};font-size:12px;line-height:18px;color:${mailColors.muted}">${MAIL_FOOTER}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`.value
}
