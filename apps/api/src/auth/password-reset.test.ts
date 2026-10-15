import { describe, expect, it } from 'vitest'
import {
  hashVerificationIdentifier,
  passwordResetLink,
  RESET_IDENTIFIER_PREFIX,
  RESET_STORED_PREFIX,
} from './password-reset'

describe('хеш идентификатора verifications', () => {
  it('оставляет имя до двоеточия, двоеточие меняет на #, а токен заменяет SHA-256', async () => {
    const hashed = await hashVerificationIdentifier('reset-password:SecretToken123')
    expect(hashed).toMatch(/^reset-password#[A-Za-z0-9_-]{43}$/)
    expect(hashed.startsWith(RESET_STORED_PREFIX)).toBe(true)
    expect(hashed).not.toContain('SecretToken123')
  })

  it('одинаковый вход — одинаковый хеш, разный — разный; без двоеточия — только хеш', async () => {
    const a = await hashVerificationIdentifier('reset-password:a')
    expect(await hashVerificationIdentifier('reset-password:a')).toBe(a)
    expect(await hashVerificationIdentifier('reset-password:b')).not.toBe(a)
    expect(await hashVerificationIdentifier('plain')).toMatch(/^#[A-Za-z0-9_-]{43}$/)
  })

  it('в базе нет двоеточия: запасной поиск Better Auth по строке как есть ничего не найдёт', async () => {
    // Better Auth ищет reset-password:<то, что прислали>. Пришли хеш из базы — строки
    // reset-password:<хеш> в базе нет и быть не может
    const stored = await hashVerificationIdentifier(`${RESET_IDENTIFIER_PREFIX}SecretToken123`)
    expect(stored).not.toContain(':')
    const hash = stored.slice(RESET_STORED_PREFIX.length)
    expect(`${RESET_IDENTIFIER_PREFIX}${hash}`).not.toBe(stored)
    expect(`${RESET_IDENTIFIER_PREFIX}${stored}`).not.toBe(stored)
  })

  it('и у идентификаторов Better Auth без двоеточия: в базе # на месте разделителя, приставки нет', async () => {
    // delete-account-<токен> (Better Auth 1.7.7, update-user.mjs) — без двоеточия. Защита держится
    // не на двоеточии, а на том, что сохранённая строка не начинается с приставки Better Auth
    for (const [prefix, token] of [
      ['delete-account-', 'SecretToken123'],
      [RESET_IDENTIFIER_PREFIX, 'SecretToken123'],
    ] as const) {
      const stored = await hashVerificationIdentifier(`${prefix}${token}`)
      expect(stored).toContain('#')
      expect(stored.startsWith(prefix)).toBe(false)
    }
  })
})

it('ссылка ведёт в админку, токен — во фрагменте', () => {
  expect(passwordResetLink('https://admin.example.ru', 'abc')).toBe(
    'https://admin.example.ru/reset-password#token=abc',
  )
})
