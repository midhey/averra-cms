import type { MailConfig } from '../config'
import { fileMailer } from './file-mailer'
import type { Mailer, MailStatus } from './mailer'
import { smtpMailer } from './smtp-mailer'

/**
 * Провайдер почты по конфигу: SMTP, файловый ящик или ничего (почта выключена). Подключают
 * index.ts и pnpm mail:test, маршруты получают только состояние без секретов
 */
export function createMailer(config: MailConfig): { mailer?: Mailer; status: MailStatus } {
  switch (config.transport) {
    case 'smtp': {
      const mailer = smtpMailer(config)
      return { mailer, status: { enabled: true, provider: mailer.info } }
    }
    case 'file': {
      const mailer = fileMailer({ dir: config.dir, from: config.from })
      return { mailer, status: { enabled: true, provider: mailer.info } }
    }
    case 'off':
      return { status: { enabled: false, reason: config.reason } }
  }
}
