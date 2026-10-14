import type { MailConfig } from '../config'
import { fileMailer } from './file-mailer'
import { describeMailer, type MailerInfo, mailStepTitles } from './mailer'
import { diagnoseSmtp, type SmtpOptions } from './smtp-mailer'
import { renderMail } from './templates'

/**
 * Проверочное письмо для pnpm mail:test — напрямую, мимо очереди и базы. Для SMTP — по шагам
 * (DNS, соединение, TLS, вход, отправка), каждый шаг печатается сразу. Возвращает, ушло ли письмо.
 * Пароль не печатается: сообщения шагов проходят maskSecrets
 */
export async function sendTestMail(
  mail: MailConfig,
  to: string,
  print: (line: string) => void,
  options: SmtpOptions = {},
) {
  if (mail.transport === 'off') {
    print(mail.reason)
    return false
  }

  const info: MailerInfo =
    mail.transport === 'smtp'
      ? {
          kind: 'smtp',
          host: mail.host,
          port: mail.port,
          security: mail.security,
          user: mail.user,
          from: mail.from,
        }
      : { kind: 'file', dir: mail.dir, from: mail.from }
  const provider = describeMailer(info)
  print(`Почта: ${provider}`)
  const rendered = renderMail('mail-test', {
    sentAt: new Date().toISOString(),
    provider: provider.slice(0, 300),
  })

  if (mail.transport === 'file') {
    const mailer = fileMailer({ dir: mail.dir, from: mail.from })
    await mailer.send({ to, ...rendered })
    print(
      `✓ Письмо для ${to} лежит в файловом ящике ${mailer.info.kind === 'file' ? mailer.info.dir : mail.dir}. ` +
        'Наружу оно не ушло: это ящик для разработки (MAIL_TRANSPORT=file)',
    )
    return true
  }

  const result = await diagnoseSmtp(mail, { to, ...rendered }, options, (step) => {
    print(`${step.ok ? '✓' : '✗'} ${mailStepTitles[step.step]}: ${step.message}`)
  })
  if (result.ok)
    print(`Готово: проверочное письмо ушло на ${to}. Если его нет во «Входящих», загляни в спам`)
  return result.ok
}
