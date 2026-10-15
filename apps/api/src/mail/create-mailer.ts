import type { MailConfig } from '../config'
import { fileMailer } from './file-mailer'
import type { DefaultMail, EnvMail } from './runtime'
import { smtpMailer } from './smtp-mailer'

/** Почта, которую задаёт конфиг: SMTP из SMTP_*, файловый ящик или выключено */
function mailOf(config: MailConfig): EnvMail {
  switch (config.transport) {
    case 'smtp': {
      const { host, port, security, user, from } = config
      return {
        kind: 'smtp',
        mailer: smtpMailer(config),
        settings: { host, port, security, user, from },
      }
    }
    case 'file':
      return { kind: 'file', mailer: fileMailer({ dir: config.dir, from: config.from }) }
    case 'off':
      return { kind: 'off', reason: config.reason }
  }
}

/**
 * Почта из конфига для MailRuntime. Решило окружение (SMTP_* или явный MAIL_TRANSPORT) — это
 * env, и оно главнее настроек в админке. Иначе это вариант по умолчанию, когда SMTP не задан
 * и в админке: файловый ящик в учебном режиме, иначе выключено. Подключает index.ts
 */
export function mailSources(config: MailConfig): { env?: EnvMail; fallback: DefaultMail } {
  const mail = mailOf(config)
  // Вариант по умолчанию при env не нужен: почту решило окружение, админка её не меняет
  if (config.fromEnv) return { env: mail, fallback: { reason: 'Почта задана в окружении API' } }
  return { fallback: mail.kind === 'off' ? { reason: mail.reason } : { mailer: mail.mailer } }
}
