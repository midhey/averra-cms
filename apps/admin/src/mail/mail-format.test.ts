import { describe, expect, it } from 'vitest'
import { attemptsLabel, daysLabel, mailStatusLabel, providerDetails } from './mail-format'

const from = { address: 'noreply@example.ru', name: 'Averra CMS' }

describe('экран «Почта»', () => {
  it('статусы письма словами', () => {
    expect(mailStatusLabel('pending')).toBe('Ждёт отправки')
    expect(mailStatusLabel('sending')).toBe('Отправляется')
    expect(mailStatusLabel('sent')).toBe('Отправлено')
    expect(mailStatusLabel('failed')).toBe('Не отправлено')
  })

  it('SMTP: сервер, шифрование, вход и отправитель', () => {
    expect(
      providerDetails({
        kind: 'smtp',
        host: 'smtp.yandex.ru',
        port: 587,
        security: 'starttls',
        user: 'noreply@example.ru',
        from,
      }),
    ).toEqual([
      ['Провайдер', 'SMTP'],
      ['Сервер', 'smtp.yandex.ru:587'],
      ['Шифрование', 'STARTTLS, обязательный'],
      ['Вход', 'noreply@example.ru'],
      ['Отправитель', 'Averra CMS <noreply@example.ru>'],
    ])
  })

  it('файловый ящик говорит, что письма не уходят наружу', () => {
    expect(providerDetails({ kind: 'file', dir: '/data/mail', from })[0]).toEqual([
      'Провайдер',
      'Файловый ящик: письма не уходят наружу',
    ])
  })

  it('попытки и дни склоняются', () => {
    expect([1, 2, 5, 11, 21, 22].map(attemptsLabel)).toEqual([
      '1 попытка',
      '2 попытки',
      '5 попыток',
      '11 попыток',
      '21 попытка',
      '22 попытки',
    ])
    expect([1, 3, 30].map(daysLabel)).toEqual(['1 день', '3 дня', '30 дней'])
  })
})
