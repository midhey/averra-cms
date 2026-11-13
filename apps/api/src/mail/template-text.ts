import { MailTemplateText } from '@averra/schema'
import { html } from './html'
import { note, paragraph } from './layout'
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

/** Подставляем один раз: фигурные скобки из значения не становятся командами шаблона */
export function renderTemplateText(
  definition: EditableTemplate,
  data: unknown,
  input: MailTemplateText,
) {
  const text = validateTemplateText(definition, input)
  const replace = (value: string) =>
    value.replace(substitutions, (_, name: string) => definition.vars[name]?.value(data) ?? '')
  const parts = paragraphs(text.body).map((part) => {
    const name = /^\{([^{}]+)\}$/.exec(part)?.[1]
    const block =
      name && Object.hasOwn(definition.blocks, name) ? definition.blocks[name] : undefined
    if (block) return block.render(data)
    const small = part.startsWith('> ')
    const value = replace(small ? part.slice(2) : part)
    const lines = value.split('\n')
    const content = html`${lines.map((line, index) => html`${index ? html`<br>` : ''}${line}`)}`
    return { html: small ? note(content) : paragraph(content), text: value }
  })
  return {
    subject: replace(text.subject),
    preheader: replace(text.preheader),
    body: html`${parts.map((part) => part.html)}`,
    text: parts.map((part) => part.text).join('\n\n'),
  }
}
