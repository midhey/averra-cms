import { randomBytes } from 'node:crypto'
import { defaultTheme } from '@averra/tokens'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { aesGcmSecretBox, KEY_BYTES } from '../crypto/aes-gcm'
import { createDb, type Db } from '../db/client'
import { migrateDb } from '../db/migrate'
import { mailSettings } from '../db/schema'
import { memoryMailer } from '../mail/memory-mailer'
import { createMailRuntime } from '../mail/runtime'
import { MAIL_PASSWORD_CONTEXT } from '../mail/settings'
import { sitesRepo } from '../modules/sites/repo'
import { MemberRole, NewUser } from '../modules/users/repo'
import { CliError, check, inviteLinkNotice, queuedMailTransport, resolveSite, run } from './common'

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
    expect(inviteLinkNotice('https://admin.example.ru', 'smtp')).toEqual([
      'Ссылка в письме ведёт в админку https://admin.example.ru.',
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
  const key = randomBytes(KEY_BYTES)

  /** Настройки SMTP из админки с паролем, зашифрованным этим ключом */
  const saveSmtp = (db: Db, sealedWith: Uint8Array) =>
    db.insert(mailSettings).values({
      host: 'smtp.example.ru',
      port: 465,
      security: 'tls',
      username: 'noreply@example.ru',
      passwordEncrypted: aesGcmSecretBox(sealedWith).encrypt('smtp-pass', MAIL_PASSWORD_CONTEXT),
      fromAddress: 'noreply@example.ru',
      fromName: 'Averra CMS',
    })

  it('SMTP из админки — тоже почта: команда не отказывает и не ставит ссылку на localhost', async () => {
    const { db, close } = createDb()
    try {
      await migrateDb(db)
      expect(await queuedMailTransport(db, { mail: off, mailEncryptionKey: key })).toEqual({
        transport: 'off',
        reason: 'Почта не настроена',
      })
      await saveSmtp(db, key)
      expect(await queuedMailTransport(db, { mail: off, mailEncryptionKey: key })).toEqual({
        transport: 'smtp',
      })
      expect(() => inviteLinkNotice('http://localhost:5173', 'smtp')).toThrow(CliError)
      // Окружение решило само — оно главнее админки
      expect(
        await queuedMailTransport(db, {
          mail: { ...off, fromEnv: true, reason: 'MAIL_TRANSPORT=off' },
          mailEncryptionKey: key,
        }),
      ).toEqual({ transport: 'off', reason: 'MAIL_TRANSPORT=off' })
    } finally {
      await close()
    }
  })

  it('пароль SMTP из админки API не расшифрует (нет ключа или не тот) — отказ с той же причиной, что у API', async () => {
    const { db, close } = createDb()
    try {
      await migrateDb(db)
      await saveSmtp(db, key)
      const [row] = await db.select().from(mailSettings)
      if (!row) throw new Error('Настройки не сохранились')
      for (const mailEncryptionKey of [undefined, randomBytes(KEY_BYTES)]) {
        const transport = await queuedMailTransport(db, { mail: off, mailEncryptionKey })
        // Причина — слово в слово та, с которой API выключил почту (MailRuntime)
        const secretBox = mailEncryptionKey ? aesGcmSecretBox(mailEncryptionKey) : undefined
        const runtime = createMailRuntime({
          db,
          fallback: { reason: 'Почта не настроена' },
          secretBox,
          smtp: { mailer: () => memoryMailer(), diagnose: async () => ({ ok: true, steps: [] }) },
        })
        await runtime.reload()
        const status = runtime.status()
        expect(status.enabled).toBe(false)
        expect(transport).toEqual({
          transport: 'off',
          reason: status.enabled ? '' : status.reason,
        })
      }
      expect(
        await queuedMailTransport(db, { mail: off, mailEncryptionKey: undefined }),
      ).toMatchObject({ reason: expect.stringContaining('без MAIL_ENCRYPTION_KEY') })
      expect(
        await queuedMailTransport(db, { mail: off, mailEncryptionKey: randomBytes(KEY_BYTES) }),
      ).toMatchObject({ reason: expect.stringContaining('MAIL_ENCRYPTION_KEY сменился') })
    } finally {
      await close()
    }
  })
})

describe('сайт команды (--site)', () => {
  it('без --site — сайт установки, с --site — указанный, неизвестный — понятная ошибка', async () => {
    const { db, close } = createDb()
    try {
      await migrateDb(db)
      await expect(resolveSite(db, undefined)).rejects.toThrow(
        'В базе нет сайта: его создаёт API при первом запуске',
      )
      const repo = sitesRepo(db)
      const first = await repo.createSite('Первый', defaultTheme)
      const second = await repo.createSite('Второй', defaultTheme)
      // В старой базе сайтов несколько: без --site — созданный первым, как у админки
      expect(await resolveSite(db, undefined)).toEqual({ id: first.id, name: 'Первый' })
      expect(await resolveSite(db, second.id)).toEqual({ id: second.id, name: 'Второй' })
      const missing = '00000000-0000-4000-8000-000000000000'
      await expect(resolveSite(db, missing)).rejects.toThrow(new CliError(`Нет сайта ${missing}`))
    } finally {
      await close()
    }
  })
})
