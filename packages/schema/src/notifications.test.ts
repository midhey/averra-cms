import { describe, expect, it } from 'vitest'
import {
  LeadEmailRecipients,
  NOTIFICATION_EVENT_TITLES,
  NotificationEventId,
  PROXY_MESSAGES,
  SaveTelegramChannel,
  ServiceEmailRecipients,
  ServiceEventId,
  splitProxyUrl,
  TelegramBotToken,
  TelegramChatId,
  TelegramProxy,
} from './notifications'

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0'

describe('уведомления: схемы', () => {
  it('у каждого события есть подпись', () => {
    for (const id of NotificationEventId.options) {
      expect(NOTIFICATION_EVENT_TITLES[id]).toBeTruthy()
    }
    expect(NotificationEventId.options).toEqual(['lead.new', ...ServiceEventId.options])
  })

  it('адреса заявок: схема почты, строчные, без повторов и не больше 10', () => {
    expect(LeadEmailRecipients.parse({ addresses: ['Boss@Example.ru'] }).addresses).toEqual([
      'boss@example.ru',
    ])
    expect(LeadEmailRecipients.safeParse({ addresses: ['a@b.ru\nBcc: x@y.ru'] }).success).toBe(
      false,
    )
    expect(LeadEmailRecipients.safeParse({ addresses: ['a@b.ru', 'A@b.ru'] }).success).toBe(false)
    const many = Array.from({ length: 11 }, (_, index) => `m${index}@example.ru`)
    expect(LeadEmailRecipients.safeParse({ addresses: many }).success).toBe(false)
  })

  it('служебные адреса: хотя бы одно событие и только служебные', () => {
    const ok = { recipients: [{ address: 'Ops@Studio.ru', events: ['disk.low'] }] }
    expect(ServiceEmailRecipients.parse(ok).recipients[0]?.address).toBe('ops@studio.ru')
    const none = { recipients: [{ address: 'ops@studio.ru', events: [] }] }
    expect(ServiceEmailRecipients.safeParse(none).success).toBe(false)
    const lead = { recipients: [{ address: 'ops@studio.ru', events: ['lead.new'] }] }
    expect(ServiceEmailRecipients.safeParse(lead).success).toBe(false)
  })

  it('токен бота — как у BotFather, пробелы по краям обрезаются', () => {
    expect(TelegramBotToken.parse(` ${TOKEN}\n`.trim())).toBe(TOKEN)
    expect(TelegramBotToken.safeParse('123:abc').success).toBe(false)
    expect(TelegramBotToken.safeParse(`${TOKEN}\nX`).success).toBe(false)
  })

  it('прокси: схема, хост и порт, без пути', () => {
    for (const ok of [
      'socks5://user:pass@proxy.example.ru:1080',
      'http://10.0.0.1:3128',
      'https://proxy.example.ru:443',
    ]) {
      expect(TelegramProxy.safeParse(ok).success, ok).toBe(true)
    }
    for (const bad of [
      'proxy.example.ru:1080',
      'ftp://proxy.example.ru:21',
      'http://proxy.example.ru',
      'http://proxy.example.ru:3128/path',
      'socks5://h:1\nX',
    ]) {
      expect(TelegramProxy.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('прокси: спецсимволы в логине и пароле — только %-кодами, иначе понятная ошибка', () => {
    // Так их прочёл бы URL: # — начало фрагмента, ? — запроса, «голый» % — не %-код
    for (const bad of [
      'socks5://user:pa#ssw0rd@127.0.0.1:1080',
      'http://user:se?cret@proxy.example.ru:3128',
      'socks5://user:pa%zz@proxy.example.ru:1080',
      'socks5://user:%FF@proxy.example.ru:1080',
      'http://user#x:topsecret@proxy.example.ru:3128',
      'socks5://user:p/ss@proxy.example.ru:1080',
      'socks5://user:p@ss@proxy.example.ru:1080',
      'socks5://us er:pass@proxy.example.ru:1080',
      'socks5://user:pa ss@proxy.example.ru:1080',
      'http://user:pa\\ss@proxy.example.ru:3128',
    ]) {
      const result = TelegramProxy.safeParse(bad)
      expect(result.success, bad).toBe(false)
      expect(result.error?.issues[0]?.message, bad).toBe(PROXY_MESSAGES.userinfo)
    }
    // Каждому отклонённому знаку — его код в тексте ошибки
    for (const code of ['# → %23', '? → %3F', '@ → %40', '/ → %2F', '% → %25', '\\ → %5C']) {
      expect(PROXY_MESSAGES.userinfo).toContain(code)
    }
    expect(PROXY_MESSAGES.userinfo).toContain('пробел → %20')
  })

  it('прокси: пустой логин — своя ошибка, а не про спецсимволы', () => {
    for (const bad of [
      'http://:pass@proxy.example.ru:3128',
      'http://@proxy.example.ru:3128',
      'socks5://:@proxy.example.ru:1080',
    ]) {
      const result = TelegramProxy.safeParse(bad)
      expect(result.error?.issues[0]?.message, bad).toBe(PROXY_MESSAGES.login)
    }
    expect(PROXY_MESSAGES.login).not.toContain('%-код')
  })

  it('прокси: %-коды раскодируются, двоеточие в пароле — можно', () => {
    const login = encodeURIComponent('студия')
    const secret = encodeURIComponent('p@ss:w/o%rd#1?')
    const encoded = `socks5://${login}:${secret}@proxy.example.ru:1080`
    expect(TelegramProxy.safeParse(encoded).success).toBe(true)
    expect(splitProxyUrl(encoded)).toEqual({
      scheme: 'socks5',
      username: 'студия',
      password: 'p@ss:w/o%rd#1?',
      host: 'proxy.example.ru',
      port: 1080,
    })
    expect(splitProxyUrl('http://user:pa:ss@10.0.0.1:3128')).toMatchObject({ password: 'pa:ss' })
    expect(splitProxyUrl('http://[::1]:8080')).toMatchObject({ host: '[::1]', username: '' })
    expect(splitProxyUrl('socks://proxy:1080')).toMatchObject({ scheme: 'socks', host: 'proxy' })
  })

  it('прокси: хост, который URL прочёл бы иначе, — ошибка у хоста', () => {
    for (const bad of [
      'http://a:b@1.2.3:3128',
      'http://010.0.0.1:3128',
      'http://256.1.1.1:3128',
      'http://0x7f:3128',
      'http://-proxy.ru:3128',
      'http://proxy..ru:3128',
    ]) {
      const result = TelegramProxy.safeParse(bad)
      expect(result.success, bad).toBe(false)
      expect(result.error?.issues[0]?.message, bad).toBe(PROXY_MESSAGES.host)
    }
    expect(TelegramProxy.safeParse('http://proxy.example.ru:0').success).toBe(false)
    expect(TelegramProxy.safeParse('http://proxy.example.ru:65536').success).toBe(false)
  })

  it('сохранение бота: пустой токен — оставить прежний, пароль владельца обязателен', () => {
    expect(
      SaveTelegramChannel.safeParse({ token: '', proxy: '', currentPassword: 'x' }).success,
    ).toBe(true)
    expect(
      SaveTelegramChannel.safeParse({ token: TOKEN, proxy: '', currentPassword: '' }).success,
    ).toBe(false)
    expect(
      SaveTelegramChannel.safeParse({ token: TOKEN, proxy: '', currentPassword: 'x', extra: 1 })
        .success,
    ).toBe(false)
  })

  it('chat id — число, у групп отрицательное', () => {
    expect(TelegramChatId.safeParse('-1001234567890').success).toBe(true)
    expect(TelegramChatId.safeParse('@channel').success).toBe(false)
  })
})
