import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { aesGcmSecretBox, KEY_BYTES } from '../crypto/aes-gcm'
import { createDb, type Db } from '../db/client'
import { migrateDb } from '../db/migrate'
import { mailSettings } from '../db/schema'
import type { Mailer, SmtpSettings } from './mailer'
import { memoryMailer } from './memory-mailer'
import { createMailRuntime, type MailRuntimeOptions } from './runtime'
import { MAIL_PASSWORD_CONTEXT, mailSettingsRepo } from './settings'

let db: Db
let close: () => Promise<void>

beforeAll(async () => {
  const created = createDb()
  db = created.db
  close = created.close
  await migrateDb(db)
})
afterAll(async () => {
  await close()
})
beforeEach(async () => {
  await db.delete(mailSettings)
})

const secretBox = aesGcmSecretBox(randomBytes(KEY_BYTES))
const PASSWORD = 'smtp-secret-password'

/** SMTP из настроек админки без сети: письма в память, а настройки запоминаются */
function fakeSmtp() {
  const created: { settings: SmtpSettings; mailer: Mailer & { closed: boolean } }[] = []
  return {
    created,
    factory: {
      mailer(settings: SmtpSettings) {
        const inner = memoryMailer({ from: settings.from })
        const mailer = {
          ...inner,
          closed: false,
          info: {
            kind: 'smtp' as const,
            host: settings.host,
            port: settings.port,
            security: settings.security,
            user: settings.user,
            from: settings.from,
          },
          async close() {
            mailer.closed = true
          },
        }
        created.push({ settings, mailer })
        return mailer
      },
      async diagnose() {
        return { ok: true, steps: [] }
      },
    },
  }
}

async function saveSettings(password = secretBox.encrypt(PASSWORD, MAIL_PASSWORD_CONTEXT)) {
  await mailSettingsRepo(db).save(
    db,
    {
      host: 'smtp.example.ru',
      port: 465,
      security: 'tls',
      user: 'noreply@example.ru',
      passwordEncrypted: password,
      fromAddress: 'noreply@example.ru',
      fromName: 'Averra CMS',
      verifiedAt: null,
      updatedBy: null,
    },
    new Date(),
  )
}

function runtime(options: Partial<MailRuntimeOptions> = {}) {
  const smtp = fakeSmtp()
  const fallback = memoryMailer()
  const created = createMailRuntime({
    db,
    fallback: { mailer: fallback },
    secretBox,
    smtp: smtp.factory,
    ...options,
  })
  return { runtime: created, smtp, fallback }
}

describe('почта процесса', () => {
  it('без окружения и настроек — вариант по умолчанию', async () => {
    const { runtime: mail, fallback } = runtime()
    await mail.reload()
    expect(mail.source()).toBe('none')
    expect(await mail.mailer()).toBe(fallback)
    const off = runtime({ fallback: { reason: 'Почта не настроена' } }).runtime
    await off.reload()
    expect(off.status()).toEqual({ enabled: false, reason: 'Почта не настроена' })
    expect(await off.mailer()).toBeUndefined()
  })

  it('настройки из админки: пароль расшифрован и ушёл в SMTP, наружу — без него', async () => {
    await saveSettings()
    const { runtime: mail, smtp } = runtime()
    await mail.reload()
    expect(mail.source()).toBe('database')
    expect(smtp.created[0]?.settings).toMatchObject({ host: 'smtp.example.ru', password: PASSWORD })
    expect(await mail.mailer()).toBe(smtp.created[0]?.mailer)
    expect(JSON.stringify(mail.status())).not.toContain(PASSWORD)
  })

  it('окружение главнее базы', async () => {
    await saveSettings()
    const envMailer = memoryMailer()
    const { runtime: mail, smtp } = runtime({
      env: {
        kind: 'smtp',
        mailer: envMailer,
        settings: {
          host: 'smtp.env.ru',
          port: 587,
          security: 'starttls',
          user: 'env@example.ru',
          from: { address: 'env@example.ru', name: 'Env' },
        },
      },
    })
    await mail.reload()
    expect(mail.source()).toBe('env')
    expect(await mail.mailer()).toBe(envMailer)
    expect(smtp.created).toHaveLength(0)

    const off = runtime({ env: { kind: 'off', reason: 'MAIL_TRANSPORT=off' } }).runtime
    await off.reload()
    expect(off.status()).toEqual({ enabled: false, reason: 'MAIL_TRANSPORT=off' })
  })

  it('нет ключа или ключ не тот — почта выключена с причиной, а не падение', async () => {
    await saveSettings()
    const noKey = runtime({ secretBox: undefined }).runtime
    await noKey.reload()
    expect(noKey.source()).toBe('database')
    expect(noKey.status()).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('без MAIL_ENCRYPTION_KEY'),
    })
    expect(await noKey.mailer()).toBeUndefined()
    const row = await mailSettingsRepo(db).get()
    if (!row) throw new Error('Настройки не сохранились')
    expect(noKey.readPassword(row)).toMatchObject({ ok: false, problem: 'no_key' })

    const otherKey = runtime({ secretBox: aesGcmSecretBox(randomBytes(KEY_BYTES)) }).runtime
    await otherKey.reload()
    expect(otherKey.status()).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/MAIL_ENCRYPTION_KEY сменился.*Введите пароль SMTP заново/),
    })
    expect(otherKey.readPassword(row)).toMatchObject({ ok: false, problem: 'wrong_key' })

    // Повреждённая запись — тоже причина, а не исключение
    const [prefix, keyId, iv, tag] = secretBox.encrypt(PASSWORD, MAIL_PASSWORD_CONTEXT).split('.')
    await db.delete(mailSettings)
    await saveSettings([prefix, keyId, iv, tag, 'QUJDRA'].join('.'))
    const broken = runtime().runtime
    await broken.reload()
    expect(broken.status()).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('запись повреждена'),
    })
    const brokenRow = await mailSettingsRepo(db).get()
    if (!brokenRow) throw new Error('Настройки не сохранились')
    expect(broken.readPassword(brokenRow)).toMatchObject({ ok: false, problem: 'corrupted' })
  })

  it('смена настроек: новый провайдер, прежний закрыт; mailer() ждёт конца смены', async () => {
    const { runtime: mail, smtp, fallback } = runtime()
    await mail.reload()
    expect(await mail.mailer()).toBe(fallback)

    let finish = () => {}
    const changing = mail.exclusive(async () => {
      await saveSettings()
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    // Пока смена идёт, обработчик ждёт: получит уже новый провайдер
    let got: Mailer | undefined
    const waiting = mail.mailer().then((mailer) => {
      got = mailer
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(got).toBeUndefined()
    finish()
    await changing
    await waiting
    expect(got).toBe(smtp.created[0]?.mailer)

    // Ещё раз: провайдер из прошлых настроек закрывается, провайдер по умолчанию — нет
    await mail.exclusive(async () => {
      await db.delete(mailSettings)
    })
    expect(smtp.created[0]?.mailer.closed).toBe(true)
    expect(await mail.mailer()).toBe(fallback)
    expect(mail.source()).toBe('none')
  })

  it('перечитать настройки после коммита не вышло — смена не теряется, прежний SMTP не работает, mailer() пробует снова', async () => {
    await saveSettings()
    const failures: string[] = []
    const {
      runtime: mail,
      smtp,
      fallback,
    } = runtime({
      logError: (message) => failures.push(message),
    })
    await mail.reload()
    expect(await mail.mailer()).toBe(smtp.created[0]?.mailer)
    try {
      // Удаление закоммичено, а первое же чтение настроек после него (reload) падает
      const result = await mail.exclusive(async () => {
        await db.delete(mailSettings)
        vi.spyOn(db, 'select').mockImplementationOnce(() => {
          throw new Error('база недоступна')
        })
        return 'removed'
      })
      // Смена прошла: exclusive её не прячет за ошибкой пересборки
      expect(result).toBe('removed')
      expect(failures).toEqual([expect.stringContaining('не смог перечитать настройки почты')])
      // Удалённый SMTP больше не отправляет: пока настройки не перечитаны, почта на паузе
      expect(smtp.created[0]?.mailer.closed).toBe(true)
      expect(mail.status()).toMatchObject({
        enabled: false,
        reason: expect.stringContaining('не смог перечитать настройки почты'),
      })
      // Обработчик спрашивает провайдера — рантайм перечитывает настройки сам
      expect(await mail.mailer()).toBe(fallback)
      expect(mail.status()).toEqual({ enabled: true, provider: fallback.info })
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('перечитать снова не вышло — почта остаётся на паузе, а не на прежнем провайдере', async () => {
    const { runtime: mail, fallback } = runtime()
    await mail.reload()
    expect(await mail.mailer()).toBe(fallback)
    try {
      // Сохранили SMTP, а перечитать не вышло ни после коммита, ни при следующем запросе
      await mail.exclusive(async () => {
        await saveSettings()
        vi.spyOn(db, 'select').mockImplementationOnce(() => {
          throw new Error('база недоступна')
        })
      })
      vi.spyOn(db, 'select').mockImplementationOnce(() => {
        throw new Error('база всё ещё недоступна')
      })
      // Письма не уходят прежним провайдером (почтой по умолчанию) мимо новых настроек
      expect(await mail.mailer()).toBeUndefined()
      expect(mail.status()).toMatchObject({ enabled: false })
      // База ожила — следующий запрос провайдера находит новые настройки
      expect((await mail.mailer())?.info).toMatchObject({ kind: 'smtp', host: 'smtp.example.ru' })
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('сбой внутри смены не блокирует обработчик', async () => {
    const { runtime: mail, fallback } = runtime()
    await mail.reload()
    await expect(
      mail.exclusive(async () => {
        throw new Error('сбой базы')
      }),
    ).rejects.toThrow('сбой базы')
    expect(await mail.mailer()).toBe(fallback)
  })
})
