import { describe, expect, it } from 'vitest'
import {
  checkedFingerprint,
  formOf,
  type PasswordProblem,
  passwordHint,
  passwordStateLabel,
  type SmtpSettingsView,
  settingsOf,
  smtpModeLabel,
  smtpStepTitle,
} from './smtp-format'

const saved: SmtpSettingsView = {
  host: 'smtp.yandex.ru',
  port: 587,
  security: 'starttls',
  user: 'noreply@example.ru',
  fromAddress: 'noreply@example.ru',
  fromName: 'Студия',
  password: 'set',
  passwordProblem: null,
  verifiedAt: null,
  updatedAt: null,
  updatedBy: null,
}

describe('настройки SMTP в админке', () => {
  it('форма из сохранённых настроек — без пароля; пустая — с режимом 465', () => {
    expect(formOf(saved)).toEqual({
      host: 'smtp.yandex.ru',
      port: 587,
      user: 'noreply@example.ru',
      password: '',
      fromAddress: 'noreply@example.ru',
      fromName: 'Студия',
    })
    expect(formOf(null)).toMatchObject({
      host: '',
      port: 465,
      password: '',
      fromName: 'Averra CMS',
    })
  })

  it('шифрование выводится из порта: 465 — TLS, 587 — STARTTLS', () => {
    expect(settingsOf({ ...formOf(saved), port: 465 })).toMatchObject({
      port: 465,
      security: 'tls',
    })
    expect(settingsOf(formOf(saved))).toMatchObject({ port: 587, security: 'starttls' })
    // Пароля в настройках нет: он уходит отдельным полем
    expect(settingsOf(formOf(saved))).not.toHaveProperty('password')
    expect(smtpModeLabel(465)).toBe('465 — TLS сразу')
    expect(smtpModeLabel(587)).toBe('587 — STARTTLS')
  })

  it('любая правка после проверки — другой отпечаток', () => {
    const form = { ...formOf(saved), password: 'secret' }
    const fingerprint = checkedFingerprint(form, 'anna@example.ru')
    expect(checkedFingerprint({ ...form }, 'anna@example.ru')).toBe(fingerprint)
    for (const change of [
      { host: 'smtp.mail.ru' },
      { port: 465 as const },
      { user: 'other@example.ru' },
      { password: 'другой' },
      { fromAddress: 'other@example.ru' },
      { fromName: 'Другое' },
    ]) {
      expect(checkedFingerprint({ ...form, ...change }, 'anna@example.ru')).not.toBe(fingerprint)
    }
    expect(checkedFingerprint(form, 'boris@example.ru')).not.toBe(fingerprint)
  })

  it('подсказки о пароле: не задан, задан, задан на сервере', () => {
    expect(passwordHint(null)).toContain('не задан')
    expect(passwordHint(saved)).toContain('Оставьте поле пустым, чтобы не менять')
    expect(passwordStateLabel(saved, 'database')).toBe('задан')
    expect(passwordStateLabel(saved, 'env')).toBe('задан на сервере')
  })

  it('пароль не читается — подсказка по причине из API, без ключа — не «введите заново»', () => {
    const unreadable = (passwordProblem: PasswordProblem): SmtpSettingsView => ({
      ...saved,
      password: 'unreadable',
      passwordProblem,
    })
    expect(passwordHint(unreadable('wrong_key'))).toBe(
      'Сохранённый пароль не читается: сменился ключ шифрования MAIL_ENCRYPTION_KEY. Введите пароль заново',
    )
    expect(passwordHint(unreadable('corrupted'))).toBe(
      'Сохранённый пароль не читается: запись в базе повреждена. Введите пароль заново',
    )
    expect(passwordHint(unreadable('format'))).toContain('запись в базе не того формата')
    // Повреждённая запись или чужой формат — не «сменился ключ»
    for (const problem of ['corrupted', 'format'] as const) {
      expect(passwordHint(unreadable(problem))).not.toContain('сменился ключ')
    }
    for (const problem of ['wrong_key', 'corrupted', 'format'] as const) {
      expect(passwordStateLabel(unreadable(problem), 'database')).toBe(
        'не читается — введите заново',
      )
    }
    // Без ключа формы нет: ввести пароль некуда
    expect(passwordStateLabel(unreadable('no_key'), 'database')).toBe(
      'задан, но без ключа MAIL_ENCRYPTION_KEY его не расшифровать',
    )
    expect(passwordHint(unreadable('no_key'))).not.toContain('Введите')
  })

  it('шаги проверки — словами', () => {
    expect(smtpStepTitle('auth')).toBe('Вход')
    expect(smtpStepTitle('tls')).toBe('TLS: шифрование и сертификат')
    expect(smtpStepTitle('новый')).toBe('новый')
  })
})
