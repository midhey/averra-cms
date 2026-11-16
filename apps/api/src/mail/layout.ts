import type { Theme } from '@averra/schema'
import { fontStack } from '@averra/tokens'
import { html, type SafeHtml } from './html'

// Почтовые клиенты не понимают нормальный CSS (Gmail режет <style>, Outlook рисует движком Word),
// поэтому вёрстка на таблицах и только инлайн-стили. Письма системы оформлены нейтрально, в стиле
// Averra CMS, а письма сайта (заявки) — цветами и шрифтами его темы и с его названием в шапке:
// посетитель получает письмо от сайта, а не от CMS. Шрифты темы в письме не загружаются (внешних
// запросов в письме нет): клиент покажет их, только если они есть на устройстве, иначе — запасные

/** Оформление письма: чьё оно, цвета и шрифты */
export type MailStyle = {
  /** Название в шапке и подвале */
  brand: string
  colors: {
    page: string
    card: string
    border: string
    text: string
    muted: string
    accent: string
    onAccent: string
  }
  /** Значение font-family текста; html`…` — константа нашего кода, строка экранируется */
  font: SafeHtml | string
  /** Шрифт названия в шапке */
  headingFont: SafeHtml | string
  /** Скругление карточки и кнопки, px */
  radius: number
}

// Константа нашего же кода, поэтому собрана html`…` и не экранируется (в ней кавычки)
const FONT = html`-apple-system, 'Segoe UI', Roboto, Arial, sans-serif`

export const averraMailStyle: MailStyle = {
  brand: 'Averra CMS',
  colors: {
    page: '#f4f5f7',
    card: '#ffffff',
    border: '#e3e5e9',
    text: '#1f2430',
    muted: '#5b6170',
    accent: '#2f5bea',
    onAccent: '#ffffff',
  },
  font: FONT,
  headingFont: FONT,
  radius: 8,
}

const radii: Record<Theme['radius'], number> = { none: 0, small: 4, medium: 8, large: 16 }

/**
 * Оформление писем сайта по его опубликованной теме. Цвета темы прошли ThemeColor (#RRGGBB),
 * а стек шрифтов — из каталога в коде; двойные кавычки в нём меняем на одинарные, чтобы не
 * закрыть атрибут style (экранирование html`…` всё равно сделает из них сущности)
 */
export function siteMailStyle(siteName: string, theme: Theme): MailStyle {
  const { colors } = theme
  const stack = (font: Theme['fonts']['body']) => fontStack(font).replaceAll('"', "'")
  return {
    brand: siteName,
    colors: {
      page: colors.background,
      card: colors.surface,
      border: colors.border,
      text: colors.text,
      muted: colors.muted,
      accent: colors.accent,
      onAccent: colors.onAccent,
    },
    font: stack(theme.fonts.body),
    headingFont: stack(theme.fonts.heading),
    radius: radii[theme.radius],
  }
}

/** Части тела письма в оформлении style: шаблоны собирают из них тело */
export function mailParts({ colors, font, headingFont, radius }: MailStyle) {
  /** Заголовок письма: шрифтом заголовков сайта */
  const heading = (content: SafeHtml | string) =>
    html`<h1 style="margin:0 0 20px;font-family:${headingFont};font-size:28px;font-weight:700;line-height:34px;color:${colors.text}">${content}</h1>`

  /** Ссылка в тексте: цветом акцента и подчёркнутая — не только цветом */
  const link = (url: string) =>
    html`<a href="${url}" style="color:${colors.accent};text-decoration:underline;word-break:break-all">${url}</a>`

  /**
   * Текст, в котором адреса, найденные pattern (только http/https), становятся ссылками. Остальное
   * экранируется как обычно
   */
  const linkify = (text: string, pattern: RegExp) => {
    const pieces: (SafeHtml | string)[] = []
    let last = 0
    for (const match of text.matchAll(pattern)) {
      pieces.push(text.slice(last, match.index), link(match[0]))
      last = match.index + match[0].length
    }
    pieces.push(text.slice(last))
    return html`${pieces}`
  }

  /** Абзац основного текста */
  const paragraph = (content: SafeHtml | string) =>
    html`<p style="margin:0 0 16px;font-family:${font};font-size:16px;line-height:24px;color:${colors.text}">${content}</p>`

  /** Мелкий приглушённый текст: пояснения, срок действия ссылки */
  const note = (content: SafeHtml | string) =>
    html`<p style="margin:0 0 12px;font-family:${font};font-size:14px;line-height:20px;color:${colors.muted}">${content}</p>`

  // Кнопка не круглее 24px: на «large» у сайта пилюля, а Outlook скругления не рисует вовсе
  const buttonRadius = Math.min(radius, 24)

  /**
   * Кнопка-ссылка и сама ссылка текстом под ней: кнопку режут некоторые клиенты, а ссылку
   * можно скопировать. Адрес уже прошёл MailUrl (только http/https) и здесь экранируется.
   * copyHint: false — без подсказки: кнопка из текста письма ведёт на обычный сайт (Telegram,
   * соцсеть), её адрес не секрет и не одноразовый, а в текстовой версии он и так есть
   */
  const button = (
    label: string,
    url: string,
    { copyHint = true }: { copyHint?: boolean } = {},
  ) => html`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 ${copyHint ? 16 : 24}px">
  <tr>
    <td style="border-radius:${buttonRadius}px;background:${colors.accent}">
      <a href="${url}" style="display:inline-block;padding:14px 24px;font-family:${font};font-size:16px;font-weight:600;line-height:20px;color:${colors.onAccent};text-decoration:none;border-radius:${buttonRadius}px">${label}</a>
    </td>
  </tr>
</table>
${copyHint ? note(html`Если кнопка не открывается, скопируйте ссылку в браузер:<br>${link(url)}`) : ''}`

  /**
   * Таблица «подпись — значение» с многострочными значениями: переводы строк сохраняются
   * (white-space: pre-wrap), а сами значения, как всё в html`…`, экранируются
   */
  const fieldTable = (
    rows: readonly (readonly [string, string])[],
  ) => html`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;border-collapse:collapse">
  ${rows.map(
    ([label, value]) => html`<tr>
    <td style="padding:8px 12px 8px 0;font-family:${font};font-size:14px;line-height:20px;color:${colors.muted};vertical-align:top;width:35%">${label}</td>
    <td style="padding:8px 0;font-family:${font};font-size:15px;line-height:22px;color:${colors.text};white-space:pre-wrap;word-break:break-word">${value}</td>
  </tr>`,
  )}
</table>`

  /** Таблица «подпись — значение» */
  const details = (
    rows: readonly (readonly [string, string])[],
  ) => html`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;border-collapse:collapse">
  ${rows.map(
    ([label, value]) => html`<tr>
    <td style="padding:6px 12px 6px 0;font-family:${font};font-size:14px;line-height:20px;color:${colors.muted};white-space:nowrap;vertical-align:top">${label}</td>
    <td style="padding:6px 0;font-family:${font};font-size:14px;line-height:20px;color:${colors.text}">${value}</td>
  </tr>`,
  )}
</table>`

  return { heading, paragraph, note, linkify, button, fieldTable, details }
}

export type MailParts = ReturnType<typeof mailParts>

/** Подвал по умолчанию; перед ним в письме стоит название: «Averra CMS · …» */
export const MAIL_FOOTER = 'письмо отправлено автоматически, отвечать на него не нужно'

/** Строка подвала с названием: она же — последняя строка текстовой версии */
export const footerLine = (style: MailStyle, footer = MAIL_FOOTER) => `${style.brand} · ${footer}`

/**
 * Документ письма целиком. preheader — строка, которую почтовый клиент показывает в списке
 * писем рядом с темой; в самом письме она скрыта
 */
export function mailLayout({
  subject,
  preheader,
  body,
  footer = MAIL_FOOTER,
  style = averraMailStyle,
}: {
  subject: string
  preheader: string
  body: SafeHtml
  footer?: string
  style?: MailStyle
}) {
  const { colors, font, headingFont, radius } = style
  return html`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${colors.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${colors.page}">
  <tr>
    <td align="center" style="padding:24px 12px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px">
        <tr>
          <td align="center" style="padding:8px 4px 20px;font-family:${headingFont};font-size:22px;font-weight:700;line-height:28px;color:${colors.text}">${style.brand}</td>
        </tr>
        <tr>
          <td style="padding:36px 32px 16px;background:${colors.card};border:1px solid ${colors.border};border-top:4px solid ${colors.accent};border-radius:${radius}px">
            ${body}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:16px 4px;font-family:${font};font-size:12px;line-height:18px;color:${colors.muted}">${footerLine(style, footer)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`.value
}
