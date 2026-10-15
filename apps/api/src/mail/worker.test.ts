import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../db/client'
import { migrateDb } from '../db/migrate'
import { mailOutbox } from '../db/schema'
import { MailSendError } from './mailer'
import { memoryMailer } from './memory-mailer'
import { enqueueMail } from './outbox'
import { smtpFailure } from './smtp-mailer'
import { type MailWorker, processOutbox, startMailWorker } from './worker'

let db: Db
let close: () => Promise<void>
let worker: MailWorker | undefined

// База одна на файл (миграции на каждый тест под нагрузкой не укладывались в тайм-аут),
// а очередь перед каждым тестом пустая: тесты не забирают письма друг друга
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
  await db.delete(mailOutbox)
})
afterEach(async () => {
  await worker?.stop()
  worker = undefined
})

const testMail = (to = 'anna@example.ru') => ({
  template: 'mail-test' as const,
  data: { sentAt: new Date().toISOString(), provider: 'тест' },
  to,
})

const settings = { maxAttempts: 3, retentionDays: 30 }

/** Ждёт условия, проверяя его каждые 10 мс */
async function until(check: () => boolean | Promise<boolean>, timeoutMs = 5000) {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('не дождались')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const statusOf = async (id: string) =>
  (await db.select({ status: mailOutbox.status }).from(mailOutbox).where(eq(mailOutbox.id, id)))[0]
    ?.status

describe('обработчик в процессе API', () => {
  it('сам забирает письма из очереди', async () => {
    const mailer = memoryMailer()
    const { id } = await enqueueMail(db, testMail())
    worker = startMailWorker({ db, mailer, ...settings, intervalMs: 20 })
    await until(async () => (await statusOf(id)) === 'sent')
    expect(mailer.sent).toHaveLength(1)
  })

  it('wake будит его сразу, не дожидаясь следующего круга', async () => {
    const mailer = memoryMailer()
    worker = startMailWorker({ db, mailer, ...settings, intervalMs: 60 * 60 * 1000 })
    // Первый круг идёт сразу при старте: даём ему пройти по пустой очереди
    await new Promise((resolve) => setTimeout(resolve, 100))
    const { id } = await enqueueMail(db, testMail())
    worker.wake()
    await until(async () => (await statusOf(id)) === 'sent')
  })

  it('stop ждёт отправку, которая уже идёт, и больше писем не берёт', async () => {
    let release: () => void = () => {}
    let started = 0
    const mailer = memoryMailer({
      beforeSend: () => {
        started += 1
        return new Promise<void>((resolve) => {
          release = resolve
        })
      },
    })
    const first = await enqueueMail(db, testMail('first@example.ru'), new Date(Date.now() - 1000))
    const second = await enqueueMail(db, testMail('second@example.ru'))
    worker = startMailWorker({ db, mailer, ...settings, intervalMs: 20 })
    await until(() => started === 1)

    let stopped = false
    const stopping = worker.stop().then(() => {
      stopped = true
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    // Письмо ещё отправляется — stop не вернулся
    expect(stopped).toBe(false)

    release()
    await stopping
    expect(mailer.sent.map((mail) => mail.to)).toEqual(['first@example.ru'])
    expect(await statusOf(first.id)).toBe('sent')
    // Второе письмо из той же пачки отпущено обратно в очередь, а не брошено в «отправляется»
    expect(await statusOf(second.id)).toBe('pending')
    const [row] = await db.select().from(mailOutbox).where(eq(mailOutbox.id, second.id))
    expect(row?.attempts).toBe(0)

    // После остановки круги не идут
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(started).toBe(1)
  })

  it('чистит старые письма', async () => {
    const [old] = await db
      .insert(mailOutbox)
      .values({
        template: 'mail-test',
        data: null,
        recipient: 'a@b.ru',
        status: 'sent',
        sentAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: mailOutbox.id })
    worker = startMailWorker({ db, mailer: memoryMailer(), ...settings, intervalMs: 20 })
    await until(async () => (await statusOf(old?.id as string)) === undefined)
  })

  it('сервер не принял вход — обработчик выжидает, а не логинится на каждом круге; wake будит', async () => {
    let logins = 0
    const mailer = memoryMailer({
      beforeSend: () => {
        logins += 1
        throw new MailSendError('Сервер не принял логин или пароль', false, 'auth')
      },
    })
    const logs: string[] = []
    await enqueueMail(db, testMail('a@example.ru'), new Date(Date.now() - 2000))
    await enqueueMail(db, testMail('b@example.ru'), new Date(Date.now() - 1000))
    worker = startMailWorker({
      db,
      mailer,
      ...settings,
      intervalMs: 20,
      log: (message) => logs.push(message),
    })
    await until(() => logins === 1)
    // Круг идёт раз в 20 мс, но после сбоя входа пауза — минута: за 200 мс входов больше нет
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(logins).toBe(1)
    expect(logs.join('\n')).toContain('следующая попытка через 60 с')

    // «Повторить» в админке будит обработчик и во время паузы
    worker.wake()
    await until(() => logins === 2)
  })

  it('сервер не принял адрес отправителя — очередь не сжигается за один круг, обработчик выжидает', async () => {
    // 553 на MAIL FROM, как у Яндекс 360 с MAIL_FROM не от того ящика: так его разберёт smtpMailer
    const rejected = smtpFailure(
      Object.assign(new Error('Mail command failed: 553 5.7.1 Sender address rejected'), {
        code: 'EENVELOPE',
        command: 'MAIL FROM',
        responseCode: 553,
      }),
      {
        host: 'smtp.yandex.ru',
        port: 465,
        security: 'tls',
        user: 'robot@example.ru',
        password: 'smtp-secret',
        from: { address: 'noreply@example.ru', name: 'Averra CMS' },
      },
    )
    let sends = 0
    const mailer = memoryMailer({
      beforeSend: () => {
        sends += 1
        throw rejected
      },
    })
    const logs: string[] = []
    // Писем больше пачки: раньше круг брал пачку за пачкой и помечал неотправленными все
    for (let i = 0; i < 5; i++) {
      await enqueueMail(db, testMail(`${i}@example.ru`), new Date(Date.now() - 5000 + i))
    }
    worker = startMailWorker({
      db,
      mailer,
      ...settings,
      batchSize: 2,
      intervalMs: 20,
      log: (message) => logs.push(message),
    })
    await until(() => sends === 1)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(sends).toBe(1)
    const rows = await db
      .select({ status: mailOutbox.status, attempts: mailOutbox.attempts })
      .from(mailOutbox)
    expect(rows).toHaveLength(5)
    expect(rows.every((row) => row.status === 'pending' && row.attempts === 0)).toBe(true)
    expect(logs.join('\n')).toContain('следующая попытка через 60 с')
    expect(logs.join('\n')).toContain('Сервер не принял адрес отправителя')
  })

  it('без провайдера (почта выключена) писем не шлёт, но очередь чистит', async () => {
    const { id: waiting } = await enqueueMail(db, testMail())
    const [old] = await db
      .insert(mailOutbox)
      .values({
        template: 'mail-test',
        data: {},
        recipient: 'a@b.ru',
        createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: mailOutbox.id })
    worker = startMailWorker({ db, ...settings, intervalMs: 20 })
    await until(async () => (await statusOf(old?.id as string)) === undefined)
    expect(await statusOf(waiting)).toBe('pending')
  })

  it('провайдер функцией: берётся перед каждым письмом — смена настроек видна посреди пачки', async () => {
    const first = memoryMailer()
    const second = memoryMailer()
    let current = first
    // Провайдер меняется, пока первое письмо отправляется: как сохранение настроек в админке
    first.send = ((send) => async (mail) => {
      const sent = await send(mail)
      current = second
      return sent
    })(first.send.bind(first))
    await enqueueMail(db, testMail('a@example.ru'), new Date(Date.now() - 2000))
    await enqueueMail(db, testMail('b@example.ru'), new Date(Date.now() - 1000))
    const result = await processOutbox({ db, mailer: async () => current, ...settings })
    expect(result).toMatchObject({ claimed: 2, sent: 2, mailOff: false })
    expect(first.sent.map((mail) => mail.to)).toEqual(['a@example.ru'])
    expect(second.sent.map((mail) => mail.to)).toEqual(['b@example.ru'])
  })

  it('почта выключилась посреди пачки — остальные письма отпущены без траты попытки', async () => {
    const mailer = memoryMailer()
    let enabled = true
    mailer.send = ((send) => async (mail) => {
      const sent = await send(mail)
      enabled = false
      return sent
    })(mailer.send.bind(mailer))
    await enqueueMail(db, testMail('a@example.ru'), new Date(Date.now() - 2000))
    const { id: second } = await enqueueMail(
      db,
      testMail('b@example.ru'),
      new Date(Date.now() - 1000),
    )
    const result = await processOutbox({
      db,
      mailer: async () => (enabled ? mailer : undefined),
      ...settings,
    })
    expect(result).toMatchObject({ claimed: 2, sent: 1, mailOff: true })
    expect(await statusOf(second)).toBe('pending')
    const [row] = await db.select().from(mailOutbox).where(eq(mailOutbox.id, second))
    expect(row?.attempts).toBe(0)
  })

  it('обработчик с провайдером функцией: нет провайдера — только чистит, появился — шлёт', async () => {
    let current: ReturnType<typeof memoryMailer> | undefined
    const { id } = await enqueueMail(db, testMail())
    worker = startMailWorker({ db, mailer: async () => current, ...settings, intervalMs: 20 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await statusOf(id)).toBe('pending')
    current = memoryMailer()
    worker.wake()
    await until(async () => (await statusOf(id)) === 'sent')
    expect(current.sent).toHaveLength(1)
  })

  it('вместе с очередью чистит и остальное по тому же сроку (приглашения)', async () => {
    const calls: Date[] = []
    const logs: string[] = []
    const now = new Date('2026-10-14T12:00:00Z')
    worker = startMailWorker({
      db,
      ...settings,
      now: () => now,
      intervalMs: 20,
      log: (message) => logs.push(message),
      cleanupAlso: [
        {
          what: 'приглашения',
          run: async (before) => {
            calls.push(before)
            return 2
          },
        },
      ],
    })
    await until(() => logs.some((line) => line.startsWith('Удалено старых записей')))
    expect(calls[0]).toEqual(new Date('2026-09-14T12:00:00Z'))
    expect(logs).toContain('Удалено старых записей (приглашения): 2')
  })
})
