import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ForgotPassword,
  InvitationRegister,
  InvitationToken,
  NewInvitation,
  NewPassword,
  ResetPassword,
  SignIn,
  UserEmail,
  UserName,
} from './auth'
import { demoSiteId } from './demo'

describe('форма входа', () => {
  it('пропускает почту с пробелами по краям и любой непустой пароль', () => {
    expect(SignIn.parse({ email: ' owner@example.ru ', password: 'x' })).toEqual({
      email: 'owner@example.ru',
      password: 'x',
    })
  })

  it('не пропускает кривую почту и пустой пароль — с сообщением у каждого поля', () => {
    const result = SignIn.safeParse({ email: 'owner', password: '' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['email', 'Нужна почта вида name@example.ru'],
      ['password', 'Введите пароль'],
    ])
  })

  it('не принимает лишних полей', () => {
    expect(SignIn.safeParse({ email: 'a@b.ru', password: 'x', role: 'owner' }).success).toBe(false)
  })
})

it('id демо-сайта проходит проверку параметра :siteId в API', () => {
  expect(z.uuid().safeParse(demoSiteId).success).toBe(true)
})

const messagesOf = (result: { error?: z.ZodError }) =>
  result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])

describe('почта пользователя', () => {
  it('обрезает пробелы и приводит к нижнему регистру', () => {
    expect(UserEmail.parse('  Anna@Example.RU ')).toBe('anna@example.ru')
  })

  it('не пропускает перевод строки и слишком длинный адрес', () => {
    expect(UserEmail.safeParse('anna@example.ru\nBcc: x@evil.test').success).toBe(false)
    expect(UserEmail.safeParse(`${'a'.repeat(250)}@example.ru`).success).toBe(false)
  })
})

describe('имя пользователя', () => {
  it('одна строка от 1 до 80 символов, пробелы по краям обрезаются', () => {
    expect(UserName.parse('  Анна  ')).toBe('Анна')
    expect(messagesOf(UserName.safeParse('   '))).toEqual([['', 'Введите имя']])
    expect(UserName.safeParse('а'.repeat(81)).success).toBe(false)
  })

  it('не пропускает переводы строки и управляющие символы', () => {
    for (const name of ['Анна\nBcc', 'Анна\r', 'Анна\u2028', 'Анна\u0000']) {
      expect(UserName.safeParse(name).success, JSON.stringify(name)).toBe(false)
    }
  })
})

describe('новый пароль', () => {
  it('от 10 до 128 символов', () => {
    expect(messagesOf(NewPassword.safeParse('short'))).toEqual([['', 'Пароль — от 10 символов']])
    expect(NewPassword.safeParse('x'.repeat(10)).success).toBe(true)
    expect(NewPassword.safeParse('x'.repeat(129)).success).toBe(false)
  })
})

describe('сброс пароля', () => {
  it('«Забыли пароль?» принимает только почту', () => {
    expect(ForgotPassword.parse({ email: 'Anna@Example.ru' })).toEqual({ email: 'anna@example.ru' })
    expect(
      ForgotPassword.safeParse({ email: 'a@b.ru', redirectTo: 'https://evil.test' }).success,
    ).toBe(false)
  })

  it('новый пароль по ссылке — с токеном Better Auth: 24 буквы и цифры', () => {
    const newPassword = 'x'.repeat(10)
    expect(ResetPassword.safeParse({ token: 'aB3'.repeat(8), newPassword }).success).toBe(true)
    for (const token of [
      '',
      'abc',
      'a'.repeat(25),
      // Хеш из базы (SHA-256, base64url) токеном не считается
      `reset-password#${'A'.repeat(43)}`,
      `${'A'.repeat(23)}_`,
      `${'A'.repeat(23)}:`,
    ]) {
      expect(ResetPassword.safeParse({ token, newPassword }).success).toBe(false)
    }
  })
})

describe('приглашения', () => {
  const token = `inv_${demoSiteId}_${'a'.repeat(64)}`

  it('роль — только editor или client', () => {
    expect(NewInvitation.parse({ email: 'A@b.ru', role: 'client' })).toEqual({
      email: 'a@b.ru',
      role: 'client',
    })
    expect(messagesOf(NewInvitation.safeParse({ email: 'a@b.ru', role: 'owner' }))).toEqual([
      ['role', 'Роль на сайте — editor или client'],
    ])
  })

  it('токен — по формату ссылки из письма', () => {
    expect(InvitationToken.parse(` ${token} `)).toBe(token)
    for (const bad of ['', 'inv_x_y', token.slice(0, -1), token.replace('inv_', 'cms_')]) {
      expect(InvitationToken.safeParse(bad).success, bad).toBe(false)
    }
    expect(messagesOf(InvitationToken.safeParse('inv_x'))).toEqual([
      ['', 'Ссылка приглашения повреждена: откройте её из письма целиком'],
    ])
  })

  it('новый пользователь задаёт имя и пароль', () => {
    expect(
      InvitationRegister.safeParse({ token, name: 'Анна', password: 'x'.repeat(10) }).success,
    ).toBe(true)
    expect(
      messagesOf(InvitationRegister.safeParse({ token, name: '', password: 'short' })),
    ).toEqual([
      ['name', 'Введите имя'],
      ['password', 'Пароль — от 10 символов'],
    ])
  })
})
