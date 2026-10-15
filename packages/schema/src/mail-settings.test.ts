import { describe, expect, it } from 'vitest'
import {
  CheckMailSettings,
  DeleteMailSettings,
  MailSettingsFields,
  SaveMailSettings,
  SmtpHost,
  SmtpPassword,
} from './mail-settings'
import { setupZodMessages } from './zod-messages'

setupZodMessages()

const settings = {
  host: 'smtp.example.ru',
  port: 465,
  security: 'tls',
  user: 'noreply@example.ru',
  fromAddress: 'noreply@example.ru',
  fromName: 'Averra CMS',
}

const paths = (result: { error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.'))

const breaks = ['\r', '\n', '\r\n', '\u0000', '\t', '\u007f', '\u0085', ' ', ' ']

describe('настройки SMTP', () => {
  it('принимают 465 с TLS и 587 со STARTTLS', () => {
    expect(MailSettingsFields.parse(settings)).toEqual(settings)
    expect(
      MailSettingsFields.parse({ ...settings, port: 587, security: 'starttls' }),
    ).toMatchObject({ port: 587, security: 'starttls' })
  })

  it('других портов нет, и порт идёт только со своим шифрованием', () => {
    for (const port of [25, 2525, 0, 65535, '465']) {
      expect(paths(MailSettingsFields.safeParse({ ...settings, port })), String(port)).toEqual([
        'port',
      ])
    }
    expect(paths(MailSettingsFields.safeParse({ ...settings, security: 'starttls' }))).toEqual([
      'security',
    ])
    expect(
      paths(MailSettingsFields.safeParse({ ...settings, port: 587, security: 'tls' })),
    ).toEqual(['security'])
    for (const security of ['none', 'plain', 'ssl', '']) {
      expect(paths(MailSettingsFields.safeParse({ ...settings, security })), security).toEqual([
        'security',
      ])
    }
  })

  it('схема строгая: лишнее поле — ошибка, так проверку сертификата не выключить', () => {
    for (const extra of [
      { rejectUnauthorized: false },
      { tls: { rejectUnauthorized: false } },
      { ignoreTLS: true },
      { secure: false },
      { ca: '-----BEGIN CERTIFICATE-----' },
    ]) {
      const result = MailSettingsFields.safeParse({ ...settings, ...extra })
      expect(result.success, JSON.stringify(extra)).toBe(false)
      expect(CheckMailSettings.safeParse({ ...settings, to: 'a@b.ru', ...extra }).success).toBe(
        false,
      )
      expect(
        SaveMailSettings.safeParse({ ...settings, currentPassword: 'x', skipCheck: true, ...extra })
          .success,
      ).toBe(false)
    }
  })

  it('хост — имя или IPv4: без схемы, порта, пути и пробелов; регистр и точка в конце убираются', () => {
    expect(SmtpHost.parse('SMTP.Yandex.RU')).toBe('smtp.yandex.ru')
    expect(SmtpHost.parse(' smtp.yandex.ru. ')).toBe('smtp.yandex.ru')
    expect(SmtpHost.parse('localhost')).toBe('localhost')
    expect(SmtpHost.parse('192.168.1.10')).toBe('192.168.1.10')
    for (const host of [
      'smtp://smtp.yandex.ru',
      'smtp.yandex.ru:465',
      'smtp.yandex.ru/mail',
      'smtp yandex.ru',
      '',
      'смтп.рф',
      '-smtp.ru',
    ]) {
      expect(SmtpHost.safeParse(host).success, host).toBe(false)
    }
  })

  it.each(breaks)('управляющий символ %j в хосте, логине, адресе и имени — ошибка', (char) => {
    for (const field of ['host', 'user', 'fromAddress', 'fromName'] as const) {
      const value = `${settings[field]}${char}Bcc: x@y.ru`
      expect(paths(MailSettingsFields.safeParse({ ...settings, [field]: value })), field).toEqual([
        field,
      ])
      // И в самом конце строки: обрезка пробелов не должна молча съесть перевод строки
      expect(
        MailSettingsFields.safeParse({ ...settings, [field]: `${settings[field]}${char}` }).success,
        field,
      ).toBe(false)
    }
    expect(SmtpPassword.safeParse(`secret${char}`).success).toBe(false)
  })

  it('пароль SMTP: пустая строка разрешена (оставить прежний), до 256 символов', () => {
    expect(SmtpPassword.parse('')).toBe('')
    expect(SmtpPassword.parse(' пароль с пробелами ')).toBe(' пароль с пробелами ')
    expect(SmtpPassword.safeParse('x'.repeat(257)).success).toBe(false)
  })

  it('проверка требует адрес для проверочного письма', () => {
    expect(paths(CheckMailSettings.safeParse(settings))).toEqual(['to'])
    expect(
      CheckMailSettings.parse({ ...settings, password: 'secret', to: 'anna@example.ru' }),
    ).toMatchObject({ password: 'secret', to: 'anna@example.ru' })
  })

  it('сохранение — только с паролем владельца и итогом проверки или явным «без проверки»', () => {
    expect(paths(SaveMailSettings.safeParse({ ...settings, skipCheck: true }))).toEqual([
      'currentPassword',
    ])
    expect(paths(SaveMailSettings.safeParse({ ...settings, currentPassword: 'x' }))).toEqual([
      'checkToken',
    ])
    expect(
      paths(
        SaveMailSettings.safeParse({
          ...settings,
          currentPassword: 'x',
          checkToken: 't',
          skipCheck: true,
        }),
      ),
    ).toEqual(['skipCheck'])
    expect(
      paths(SaveMailSettings.safeParse({ ...settings, currentPassword: 'x', skipCheck: false })),
    ).toContain('skipCheck')
    expect(
      SaveMailSettings.safeParse({ ...settings, currentPassword: 'x', checkToken: 't' }).success,
    ).toBe(true)
    expect(
      SaveMailSettings.safeParse({ ...settings, currentPassword: 'x', skipCheck: true }).success,
    ).toBe(true)
  })

  it('удаление — только с паролем владельца, и больше ничего', () => {
    expect(DeleteMailSettings.safeParse({ currentPassword: 'x' }).success).toBe(true)
    expect(paths(DeleteMailSettings.safeParse({}))).toEqual(['currentPassword'])
    expect(DeleteMailSettings.safeParse({ currentPassword: 'x', force: true }).success).toBe(false)
  })
})
