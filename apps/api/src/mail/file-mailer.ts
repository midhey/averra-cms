import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { composeMail } from './compose'
import { checkOutgoing, type Mailer, type MailSender } from './mailer'

/** Что лежит в .json рядом с .eml: письмо целиком, его удобно читать глазами и в e2e */
export type FileMail = {
  messageId: string
  createdAt: string
  from: MailSender
  to: string
  replyTo?: string
  subject: string
  text: string
  html: string
  /** Имя .eml рядом: открывается почтовым клиентом */
  eml: string
}

/**
 * Файловый ящик для разработки: письма не уходят наружу, а ложатся в папку парой файлов —
 * <время>-<id>.eml (сырое письмо, как его отправил бы SMTP) и .json (поля письма).
 * Имена сортируются по времени, папка создаётся при первом письме
 */
export function fileMailer({ dir, from }: { dir: string; from: MailSender }): Mailer {
  const root = resolve(dir)
  return {
    info: { kind: 'file', dir: root, from },
    async send(outgoing) {
      const mail = checkOutgoing(outgoing)
      const { raw, messageId } = await composeMail(from, mail)
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
      const eml = `${name}.eml`
      const json: FileMail = {
        messageId,
        createdAt: new Date().toISOString(),
        from,
        to: mail.to,
        ...(mail.replyTo === undefined ? {} : { replyTo: mail.replyTo }),
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        eml,
      }
      await mkdir(root, { recursive: true })
      await writeFile(join(root, eml), raw)
      await writeFile(join(root, `${name}.json`), `${JSON.stringify(json, null, 2)}\n`)
      return { messageId }
    },
    async close() {},
  }
}
