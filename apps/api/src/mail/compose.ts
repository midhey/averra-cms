import { createTransport } from 'nodemailer'
import { checkOutgoing, type MailSender, type OutgoingMail, senderOf } from './mailer'

// Сырое письмо (.eml) собирает nodemailer, как и при отправке по SMTP: кодировка заголовков,
// Message-ID и части HTML и текста у файлового ящика и у SMTP одинаковые

const composer = createTransport({
  streamTransport: true,
  buffer: true,
  newline: 'unix',
  // Письма системы не берут вложения с диска и по ссылкам: им незачем
  disableFileAccess: true,
  disableUrlAccess: true,
})

/** Поля письма для nodemailer: заголовки ещё раз проходят схемы, From — из конфига */
export function messageOf(from: MailSender, mail: OutgoingMail) {
  const checked = checkOutgoing(mail)
  return {
    from: senderOf(from),
    to: checked.to,
    subject: checked.subject,
    html: checked.html,
    text: checked.text,
    ...(checked.replyTo === undefined ? {} : { replyTo: checked.replyTo }),
    disableFileAccess: true,
    disableUrlAccess: true,
  }
}

/** Сырое письмо и его Message-ID */
export async function composeMail(from: MailSender, mail: OutgoingMail) {
  const info = await composer.sendMail(messageOf(from, mail))
  return { raw: info.message as Buffer, messageId: info.messageId }
}
