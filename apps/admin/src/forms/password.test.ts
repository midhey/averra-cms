import { describe, expect, it } from 'vitest'
import { zodFieldErrors } from './field-errors'
import { InvitedUserForm } from './password'

describe('новый пароль дважды', () => {
  const Form = InvitedUserForm

  it('пароли совпадают — проходит', () => {
    const parsed = Form.safeParse({
      name: 'Анна',
      password: 'long-password-1',
      repeat: 'long-password-1',
    })
    expect(parsed.success).toBe(true)
  })

  it('не совпадают — ошибка у второго поля', () => {
    const parsed = Form.safeParse({ name: 'Анна', password: 'long-password-1', repeat: 'other' })
    expect(zodFieldErrors(parsed.error)).toEqual({ repeat: 'Пароли не совпадают' })
  })

  it('короткий пароль — ошибка у пароля', () => {
    const parsed = Form.safeParse({ name: 'Анна', password: 'short', repeat: 'short' })
    expect(zodFieldErrors(parsed.error)).toEqual({ password: 'Пароль — от 10 символов' })
  })
})
