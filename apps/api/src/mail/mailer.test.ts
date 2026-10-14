import { describe, expect, it } from 'vitest'
import { checkOutgoing, describeMailer, MailSendError, maskSecrets, smtpSecrets } from './mailer'

const NUL = String.fromCharCode(0)
const base64 = (value: string) => Buffer.from(value, 'utf8').toString('base64')

describe('maskSecrets', () => {
  const user = 'noreply@averra.test'
  const password = 'пароль-с-юникодом-42'

  it('убирает сам пароль и его base64 из AUTH LOGIN и AUTH PLAIN', () => {
    const plain = base64(`${NUL}${user}${NUL}${password}`)
    const text = `сервер ответил: ${password}; LOGIN ${base64(password)}; PLAIN ${plain}`
    const masked = maskSecrets(text, smtpSecrets(user, password))
    expect(masked).toBe('сервер ответил: ***; LOGIN ***; PLAIN ***')
  })

  it('пустой или не заданный секрет текст не портит', () => {
    expect(maskSecrets('ошибка', ['', undefined])).toBe('ошибка')
  })
})

describe('письмо перед отправкой', () => {
  const mail = { to: 'anna@example.ru', subject: 'Тема', html: '<p>x</p>', text: 'x' }

  it('проходит с правильными заголовками', () => {
    expect(checkOutgoing(mail)).toEqual(mail)
  })

  it.each([
    { subject: 'Тема\r\nBcc: x@example.ru' },
    { to: 'anna@example.ru\nBcc: x@example.ru' },
    { replyTo: 'x@example.ru\r\n' },
  ])('перевод строки в заголовке %j — постоянная ошибка', (broken) => {
    let error: unknown
    try {
      checkOutgoing({ ...mail, ...broken })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(MailSendError)
    expect((error as MailSendError).permanent).toBe(true)
  })
})

describe('описание провайдера', () => {
  it('без пароля: его нет и в самом описании провайдера', () => {
    const text = describeMailer({
      kind: 'smtp',
      host: 'smtp.example.ru',
      port: 465,
      security: 'tls',
      user: 'noreply@example.ru',
      from: { address: 'noreply@example.ru', name: 'Averra CMS' },
    })
    expect(text).toBe(
      'SMTP smtp.example.ru:465 (TLS), вход noreply@example.ru, отправитель Averra CMS <noreply@example.ru>',
    )
  })
})
