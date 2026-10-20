import {
  checkOutgoing,
  type Mailer,
  type MailSender,
  type OutgoingMail,
  type SentMail,
} from './mailer'

/** Письмо, которое «отправил» memoryMailer: с From, как его поставил бы провайдер */
export type MemoryMail = OutgoingMail & { from: MailSender; messageId: string }

const TEST_SENDER: MailSender = { address: 'noreply@averra.test', name: 'Averra CMS' }

/**
 * Почта в памяти — для тестов. beforeSend даёт тесту сломать отправку (бросить MailSendError)
 * или задержать её, чтобы проверить повторы и остановку обработчика
 */
export function memoryMailer({
  from = TEST_SENDER,
  beforeSend,
}: {
  from?: MailSender
  beforeSend?: (mail: OutgoingMail) => void | Promise<void>
} = {}) {
  const sent: MemoryMail[] = []
  let count = 0
  const mailer: Mailer & { sent: MemoryMail[] } = {
    info: { kind: 'memory', from },
    sent,
    async send(mail): Promise<SentMail> {
      // Те же проверки заголовков, что у настоящих провайдеров
      const checked = checkOutgoing(mail)
      await beforeSend?.(checked)
      count += 1
      const messageId = `<memory-${count}@averra.test>`
      sent.push({ ...checked, from, messageId })
      return { messageId }
    },
    async close() {},
  }
  return mailer
}
