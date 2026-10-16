import { describe, expect, it } from 'vitest'
import { mailboxKey } from './mailbox-key'

describe('ящик адреса для лимитов (mailboxKey)', () => {
  it.each([
    ['Vasya@Example.RU', 'vasya@example.ru'],
    ['vasya+1@example.ru', 'vasya@example.ru'],
    ['vasya+spam+2@mail.ru', 'vasya@mail.ru'],
    ['V.Asya+x@Gmail.com', 'vasya@gmail.com'],
    ['v.a.s.y.a@googlemail.com', 'vasya@gmail.com'],
    ['ivan.ivanov@ya.ru', 'ivan-ivanov@yandex.ru'],
    ['Ivan-Ivanov+promo@yandex.com', 'ivan-ivanov@yandex.ru'],
    ['anna@пример.рф', 'anna@xn--e1afmkfd.xn--p1ai'],
    ['anna@XN--E1AFMKFD.XN--P1AI', 'anna@xn--e1afmkfd.xn--p1ai'],
  ])('%s → %s', (address, key) => {
    expect(mailboxKey(address)).toBe(key)
  })

  it('точки в имени и разные ящики обычного домена не склеиваются', () => {
    expect(mailboxKey('ivan.ivanov@example.ru')).toBe('ivan.ivanov@example.ru')
    expect(mailboxKey('vasya@example.ru')).not.toBe(mailboxKey('petya@example.ru'))
    expect(mailboxKey('vasya@gmail.com')).not.toBe(mailboxKey('vasya@example.ru'))
  })
})
