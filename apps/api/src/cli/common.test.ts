import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createDb } from '../db/client'
import { migrateDb } from '../db/migrate'
import { mailSettings } from '../db/schema'
import { MemberRole, NewUser } from '../modules/users/repo'
import { CliError, check, inviteLinkNotice, queuedMailTransport, run } from './common'

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

/** Что команда напечатала бы человеку, если main упадёт */
async function printed(main: () => Promise<void>) {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await run(main)
  expect(process.exitCode).toBe(1)
  return String(error.mock.calls[0]?.[0])
}

describe('команды терминала', () => {
  it('ошибки аргументов пишут по-русски: и свои сообщения схем, и стандартные Zod', async () => {
    const text = await printed(async () => {
      check(
        NewUser.omit({ password: true }),
        { email: 'anna@example.ru', name: 'а'.repeat(81), role: 'admin' },
        'Как вызывать',
      )
    })
    expect(text).toContain('Не больше 80 символов')
    expect(text).toContain('Роль — owner или member')
    expect(text).toContain('Как вызывать')
    expect(text).not.toMatch(/Too small|Invalid option/)
  })

  it('неверная роль участника — понятными словами', async () => {
    const text = await printed(async () => {
      check(z.object({ role: MemberRole }), { role: 'owner' }, '')
    })
    expect(text).toContain('Роль на сайте — editor или client')
  })
})

describe('ссылка из письма команды', () => {
  it('всегда говорит, куда ведёт ссылка, а про localhost предупреждает', () => {
    expect(inviteLinkNotice('https://admin.averra.ru', 'smtp')).toEqual([
      'Ссылка в письме ведёт в админку https://admin.averra.ru.',
    ])
    const local = inviteLinkNotice('http://localhost:5173', 'file')
    expect(local[0]).toBe('Ссылка в письме ведёт в админку http://localhost:5173.')
    expect(local[1]).toContain('задай ADMIN_URL')
  })

  it('ссылку на localhost по настоящей почте не ставит: отказ до записи в базу', () => {
    expect(() => inviteLinkNotice('http://127.0.0.1:5173', 'smtp')).toThrow(CliError)
    expect(() => inviteLinkNotice('http://localhost:5173', 'smtp')).toThrow(/Задай ADMIN_URL/)
  })
})

describe('почта для писем команд', () => {
  const base = { maxAttempts: 8, retentionDays: 30 }
  const off = { ...base, fromEnv: false, transport: 'off' as const, reason: 'Почта не настроена' }

  it('SMTP из админки — тоже почта: команда не отказывает и не ставит ссылку на localhost', async () => {
    const { db, close } = createDb()
    try {
      await migrateDb(db)
      expect(await queuedMailTransport(db, off)).toEqual({
        transport: 'off',
        reason: 'Почта не настроена',
      })
      await db.insert(mailSettings).values({
        host: 'smtp.example.ru',
        port: 465,
        security: 'tls',
        username: 'noreply@example.ru',
        passwordEncrypted: `v1.0123456789abcdef.${'A'.repeat(16)}.${'B'.repeat(22)}.Q0lQSEVS`,
        fromAddress: 'noreply@example.ru',
        fromName: 'Averra CMS',
      })
      expect(await queuedMailTransport(db, off)).toEqual({ transport: 'smtp' })
      expect(() => inviteLinkNotice('http://localhost:5173', 'smtp')).toThrow(CliError)
      // Окружение решило само — оно главнее админки
      expect(
        await queuedMailTransport(db, { ...off, fromEnv: true, reason: 'MAIL_TRANSPORT=off' }),
      ).toEqual({ transport: 'off', reason: 'MAIL_TRANSPORT=off' })
    } finally {
      await close()
    }
  })
})
