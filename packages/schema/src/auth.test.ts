import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SignIn } from './auth'
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
