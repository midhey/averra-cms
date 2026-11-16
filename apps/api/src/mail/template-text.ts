import { MailTemplateText, MailUrl } from '@averra/schema'
import { html, type SafeHtml } from './html'
import type { MailParts } from './layout'
import type { MailTemplate } from './templates/define'

export type EditableTemplate = Pick<MailTemplate, 'vars' | 'blocks' | 'defaultText'>
export type TextIssue = { path: string; message: string }

export class MailTextError extends Error {
  constructor(readonly issues: TextIssue[]) {
    super('Текст письма не прошёл проверку')
  }
}

const paragraphs = (body: string) =>
  body
    .replaceAll('\r\n', '\n')
    .trim()
    .split(/\n\s*\n/)
const substitutions = /\{([^{}]+)\}/g

/** Абзац-кнопка: `[Написать в Telegram](https://t.me/…)` целиком, и ничего больше */
const buttonLine = /^\[([^\]\n]+)\]\((\S+)\)$/
/** Заголовок: абзац с «# » в начале */
const HEADING = '# '
const NOTE = '> '
// Адрес в тексте становится ссылкой. Точка, запятая или скобка сразу после адреса — конец фразы
const urls = /https?:\/\/[^\s<>"«»{}]+[^\s<>"«»{}.,;:!?)]/g

/** Блок — отдельный абзац, иначе его легко потерять среди обычного текста */
export function validateTemplateText(definition: EditableTemplate, input: unknown) {
  const parsed = MailTemplateText.safeParse(input)
  if (!parsed.success) {
    throw new MailTextError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    )
  }
  const text = parsed.data
  const issues: TextIssue[] = []
  const used = new Set<string>()
  const parts = paragraphs(text.body)
  for (const path of ['subject', 'preheader', 'body'] as const) {
    for (const match of text[path].matchAll(substitutions)) {
      const name = match[1] ?? ''
      if (Object.hasOwn(definition.vars, name)) continue
      if (Object.hasOwn(definition.blocks, name)) {
        if (path === 'body' && parts.includes(`{${name}}`)) {
          used.add(name)
          // Каждое вхождение блока должно быть отдельным абзацем.
          if (parts.every((part) => !part.includes(`{${name}}`) || part === `{${name}}`)) continue
        }
        issues.push({ path, message: `Блок {${name}} вставьте отдельным абзацем в текст письма` })
      } else {
        issues.push({ path, message: `Неизвестная подстановка {${name}}` })
      }
    }
  }
  for (const part of parts) {
    const link = buttonLine.exec(part)
    if (link && !MailUrl.safeParse(link[2]).success) {
      issues.push({
        path: 'body',
        message: `Ссылка кнопки «${link[1]}» должна начинаться с https:// или http://`,
      })
    }
  }
  for (const [name, block] of Object.entries(definition.blocks)) {
    if (block.required && !used.has(name)) {
      issues.push({
        path: 'body',
        message: `Добавьте обязательный блок «${block.label}»: {${name}} отдельным абзацем`,
      })
    }
  }
  if (issues.length) throw new MailTextError(issues)
  return text
}

/**
 * Подставляем один раз: фигурные скобки из значения не становятся командами шаблона. Ссылками
 * становятся только адреса, которые написал автор текста: в подставленных данных (почта
 * посетителя, название формы) адрес остаётся текстом
 */
export function renderTemplateText(
  definition: EditableTemplate,
  data: unknown,
  input: MailTemplateText,
  ui: MailParts,
) {
  const text = validateTemplateText(definition, input)
  const value = (name: string) => definition.vars[name]?.value(data) ?? ''
  const replace = (source: string) =>
    source.replace(substitutions, (_, name: string) => value(name))
  /** Строка автора: адреса — ссылками, подстановки — текстом */
  const line = (source: string): SafeHtml => {
    const pieces: (SafeHtml | string)[] = []
    let last = 0
    for (const match of source.matchAll(substitutions)) {
      pieces.push(ui.linkify(source.slice(last, match.index), urls))
      pieces.push(value(match[1] ?? ''))
      last = match.index + match[0].length
    }
    pieces.push(ui.linkify(source.slice(last), urls))
    return html`${pieces}`
  }
  const parts = paragraphs(text.body).map((part) => {
    const name = /^\{([^{}]+)\}$/.exec(part)?.[1]
    const block =
      name && Object.hasOwn(definition.blocks, name) ? definition.blocks[name] : undefined
    if (block) return block.render(data, ui)
    const link = buttonLine.exec(part)
    if (link) {
      const label = replace(link[1] ?? '')
      const url = link[2] ?? ''
      return { html: ui.button(label, url, { copyHint: false }), text: `${label}: ${url}` }
    }
    if (part.startsWith(HEADING)) {
      const source = part.slice(HEADING.length).replaceAll('\n', ' ')
      return { html: ui.heading(line(source)), text: replace(source) }
    }
    const small = part.startsWith(NOTE)
    const source = small ? part.slice(NOTE.length) : part
    const content = html`${source
      .split('\n')
      .map((row, index) => html`${index ? html`<br>` : ''}${line(row)}`)}`
    return { html: small ? ui.note(content) : ui.paragraph(content), text: replace(source) }
  })
  return {
    subject: replace(text.subject),
    preheader: replace(text.preheader),
    body: html`${parts.map((part) => part.html)}`,
    text: parts.map((part) => part.text).join('\n\n'),
  }
}
