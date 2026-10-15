import { MailAddress, MailSubject } from '@averra/schema'
import { z } from 'zod'
import { MAIL_FOOTER, mailLayout } from '../layout'
import { invitationTemplate } from './invitation'
import { mailSettingsChangedTemplate } from './mail-settings-changed'
import { mailTestTemplate } from './mail-test'
import { passwordResetTemplate } from './password-reset'

/** Все шаблоны писем. Новый шаблон — файл рядом и строка здесь */
export const mailTemplates = {
  'mail-test': mailTestTemplate,
  'password-reset': passwordResetTemplate,
  invitation: invitationTemplate,
  'mail-settings-changed': mailSettingsChangedTemplate,
} as const

export type MailTemplateId = keyof typeof mailTemplates

export const MailTemplateId = z.enum(
  Object.keys(mailTemplates) as [MailTemplateId, ...MailTemplateId[]],
)

/** Данные шаблона в том виде, в каком их передают при постановке в очередь */
export type MailTemplateData<T extends MailTemplateId> = z.input<
  (typeof mailTemplates)[T]['schema']
>

/** Письмо, собранное из шаблона: всё, что нужно Mailer, кроме адреса получателя */
export type RenderedMail = { subject: string; html: string; text: string; replyTo?: string }

/** Данные шаблона не прошли его схему: при постановке в очередь или перед отправкой */
export class MailDataError extends Error {
  override name = 'MailDataError'
  constructor(
    readonly template: string,
    readonly issues: z.core.$ZodIssue[],
  ) {
    super(
      `Данные письма «${template}» не прошли проверку: ` +
        issues.map((issue) => `${issue.path.join('.') || 'данные'} — ${issue.message}`).join('; '),
    )
  }
}

/** Проверяет данные схемой шаблона. Возвращает проверенные данные или бросает MailDataError */
export function parseMailData(template: MailTemplateId, data: unknown) {
  const parsed = mailTemplates[template].schema.safeParse(data)
  if (!parsed.success) throw new MailDataError(template, parsed.error.issues)
  return parsed.data
}

/** Заголовок, который шаблон собрал из данных, проверяется своей схемой: ошибка — MailDataError */
function header(template: string, name: string, schema: z.ZodType<string>, value: string) {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new MailDataError(
    template,
    parsed.error.issues.map((issue) => ({ ...issue, path: [name, ...issue.path] })),
  )
}

/**
 * Письмо из шаблона: данные проверяются схемой, тело оборачивается в общий макет, к тексту
 * добавляется подвал. Тема и Reply-To проверяются схемами заголовков: перевод строки из данных
 * не дойдёт до заголовка письма, даже если шаблон соберёт тему из них
 */
export function renderMail(template: MailTemplateId, data: unknown): RenderedMail {
  const definition = mailTemplates[template]
  const parsed = parseMailData(template, data)
  // Схема у каждого шаблона своя, а реестр общий: TypeScript не свяжет их сам
  const content = (definition.render as (value: unknown) => ReturnType<typeof definition.render>)(
    parsed,
  )
  const subject = header(template, 'subject', MailSubject, content.subject)
  return {
    subject,
    html: mailLayout({ subject, preheader: content.preheader, body: content.body }),
    text: `${content.text}\n\n—\n${MAIL_FOOTER}\n`,
    ...(content.replyTo === undefined
      ? {}
      : { replyTo: header(template, 'replyTo', MailAddress, content.replyTo) }),
  }
}

/**
 * Шаблоны без секретов в данных: их неотправленное письмо хранит данные до очистки, и его
 * можно повторить вручную. У остальных (и у неизвестных шаблонов) данные стираются сразу
 */
export const templatesKeepingData: MailTemplateId[] = Object.values(mailTemplates)
  .filter((template) => template.secret === undefined)
  .map((template) => template.id as MailTemplateId)

/**
 * До какого времени письмо имеет смысл: срок одноразовой ссылки в нём, от постановки в очередь.
 * У писем без секрета срока нет. data — уже проверенные схемой шаблона
 */
export function mailExpiresAt(template: MailTemplateId, data: unknown, createdAt: Date) {
  const { secret } = mailTemplates[template] as { secret?: { lifetimeMs(data: unknown): number } }
  return secret === undefined ? null : new Date(createdAt.getTime() + secret.lifetimeMs(data))
}

/** Шаблоны для админки: id, название и когда письмо уходит */
export const mailTemplateList = () =>
  Object.values(mailTemplates).map(({ id, title, description }) => ({
    id: id as MailTemplateId,
    title,
    description,
  }))

/** Предпросмотр шаблона на примерных данных */
export const previewMail = (template: MailTemplateId) =>
  renderMail(template, mailTemplates[template].example)
