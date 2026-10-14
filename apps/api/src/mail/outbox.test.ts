import { defaultTheme } from '@averra/tokens'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../db/client'
import { migrateDb } from '../db/migrate'
import { mailOutbox, sites } from '../db/schema'
import { MailSendError } from './mailer'
import { memoryMailer } from './memory-mailer'
import { enqueueMail, outboxRepo, retryDelayMs, SENDING_LEASE_MS } from './outbox'
import { MailDataError } from './templates'
import { LINK_EXPIRED_ERROR, processOutbox } from './worker'

let db: Db
let close: () => Promise<void>

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

const T0 = new Date('2026-10-14T10:00:00.000Z')
const after = (ms: number) => new Date(T0.getTime() + ms)
const MINUTE = 60 * 1000

const testMail = (to = 'anna@example.ru') => ({
  template: 'mail-test' as const,
  data: { sentAt: T0.toISOString(), provider: 'тест' },
  to,
})

const rowOf = async (id: string) => {
  const [row] = await db.select().from(mailOutbox).where(eq(mailOutbox.id, id))
  if (!row) throw new Error(`Нет письма ${id}`)
  return row
}

const errorOf = async (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('ожидалась ошибка')
    },
    (error: unknown) => error,
  )

describe('постановка в очередь', () => {
  it('письмо ложится в очередь с проверенными данными и ждёт отправки', async () => {
    const { id } = await enqueueMail(db, testMail('  anna@example.ru '), T0)
    expect(await rowOf(id)).toMatchObject({
      template: 'mail-test',
      recipient: 'anna@example.ru',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: T0,
      sentAt: null,
    })
  })

  it('в той же транзакции, что и действие: откатилась транзакция — письма нет', async () => {
    const failure = await errorOf(
      db.transaction(async (tx) => {
        await tx.insert(sites).values({ name: 'Сайт с заявкой', theme: defaultTheme })
        await enqueueMail(tx, testMail(), T0)
        throw new Error('действие сломалось после постановки письма')
      }),
    )
    expect((failure as Error).message).toBe('действие сломалось после постановки письма')
    expect(await db.select().from(mailOutbox)).toEqual([])
    expect(await db.select().from(sites).where(eq(sites.name, 'Сайт с заявкой'))).toEqual([])
  })

  it('транзакция прошла — письмо в очереди вместе с действием', async () => {
    await db.transaction(async (tx) => {
      await tx.insert(sites).values({ name: 'Сайт', theme: defaultTheme })
      await enqueueMail(tx, testMail(), T0)
    })
    expect(await db.select().from(mailOutbox)).toHaveLength(1)
  })

  it('данные не по схеме шаблона отклоняются при постановке, а не через час в обработчике', async () => {
    const error = await errorOf(
      enqueueMail(db, { template: 'mail-test', data: { sentAt: 'вчера' } as never, to: 'a@b.ru' }),
    )
    expect(error).toBeInstanceOf(MailDataError)
    expect(await db.select().from(mailOutbox)).toEqual([])
  })

  it.each(['anna@example.ru\r\nBcc: all@example.ru', 'anna@example.ru\n', 'не адрес'])(
    'адрес %j отклоняется',
    async (to) => {
      const error = await errorOf(enqueueMail(db, testMail(to), T0))
      expect(error).toBeInstanceOf(MailDataError)
      expect((error as MailDataError).issues[0]?.path[0]).toBe('to')
      expect(await db.select().from(mailOutbox)).toEqual([])
    },
  )
})

describe('обработчик очереди', () => {
  const settings = { maxAttempts: 3, retentionDays: 30 }

  it('отправляет письмо и помечает его отправленным', async () => {
    const mailer = memoryMailer()
    const { id } = await enqueueMail(db, testMail(), T0)
    const result = await processOutbox({ db, mailer, ...settings, now: () => after(1000) })

    expect(result).toMatchObject({ claimed: 1, sent: 1 })
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]).toMatchObject({
      to: 'anna@example.ru',
      subject: 'Проверка почты Averra CMS',
    })
    expect(await rowOf(id)).toMatchObject({
      status: 'sent',
      attempts: 1,
      sentAt: after(1000),
      messageId: mailer.sent[0]?.messageId,
      lastError: null,
      claimId: null,
      // Данные отправленного письма больше не нужны и стёрты
      data: null,
    })
    // Второй проход ничего не отправляет
    await processOutbox({ db, mailer, ...settings, now: () => after(2000) })
    expect(mailer.sent).toHaveLength(1)
  })

  it('письмо на будущее не уходит раньше срока', async () => {
    const mailer = memoryMailer()
    await enqueueMail(db, testMail(), after(10 * MINUTE))
    await processOutbox({ db, mailer, ...settings, now: () => after(MINUTE) })
    expect(mailer.sent).toHaveLength(0)
  })

  it('сбой — повтор с растущей паузой, после последней попытки — failed', async () => {
    let fail = true
    const mailer = memoryMailer({
      beforeSend: () => {
        if (fail) throw new MailSendError('SMTP недоступен')
      },
    })
    const { id } = await enqueueMail(db, testMail(), T0)

    await processOutbox({ db, mailer, ...settings, now: () => T0 })
    let row = await rowOf(id)
    expect(row).toMatchObject({ status: 'pending', attempts: 1, lastError: 'SMTP недоступен' })
    expect(row.nextAttemptAt).toEqual(after(retryDelayMs(1)))
    expect(retryDelayMs(1)).toBe(MINUTE)

    // Раньше паузы письмо не берётся
    await processOutbox({ db, mailer, ...settings, now: () => after(30 * 1000) })
    expect((await rowOf(id)).attempts).toBe(1)

    await processOutbox({ db, mailer, ...settings, now: () => after(MINUTE) })
    row = await rowOf(id)
    expect(row).toMatchObject({ status: 'pending', attempts: 2 })
    expect(row.nextAttemptAt).toEqual(after(MINUTE + retryDelayMs(2)))
    expect(retryDelayMs(2)).toBe(3 * MINUTE)

    await processOutbox({ db, mailer, ...settings, now: () => after(4 * MINUTE) })
    row = await rowOf(id)
    expect(row).toMatchObject({ status: 'failed', attempts: 3, lastError: 'SMTP недоступен' })

    // Окончательно не отправленное письмо больше не берётся, даже когда SMTP ожил
    fail = false
    await processOutbox({ db, mailer, ...settings, now: () => after(24 * 60 * MINUTE) })
    expect(mailer.sent).toHaveLength(0)
  })

  it('пауза растёт, но не больше 6 часов', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((attempt) => retryDelayMs(attempt) / MINUTE)).toEqual([
      1, 3, 9, 27, 81, 243, 360, 360,
    ])
  })

  it('постоянный отказ сервера — сразу failed, без повторов', async () => {
    const mailer = memoryMailer({
      beforeSend: () => {
        throw new MailSendError('Сервер не принял адрес получателя', true)
      },
    })
    const { id } = await enqueueMail(db, testMail(), T0)
    await processOutbox({ db, mailer, ...settings, now: () => T0 })
    expect(await rowOf(id)).toMatchObject({ status: 'failed', attempts: 1 })
  })

  it('данные в очереди, которые не проходят нынешнюю схему, — failed с понятной причиной', async () => {
    const mailer = memoryMailer()
    const [row] = await db
      .insert(mailOutbox)
      .values({
        template: 'mail-test',
        data: { старое: 'поле' },
        recipient: 'a@b.ru',
        nextAttemptAt: T0,
      })
      .returning()
    const [ghost] = await db
      .insert(mailOutbox)
      .values({ template: 'удалённый-шаблон', data: {}, recipient: 'a@b.ru', nextAttemptAt: T0 })
      .returning()
    await processOutbox({ db, mailer, ...settings, now: () => T0 })

    expect(mailer.sent).toHaveLength(0)
    expect(await rowOf(row?.id as string)).toMatchObject({ status: 'failed' })
    expect((await rowOf(row?.id as string)).lastError).toContain('не прошли проверку')
    expect(await rowOf(ghost?.id as string)).toMatchObject({
      status: 'failed',
      lastError: 'Шаблона «удалённый-шаблон» больше нет',
    })
  })

  it('два обработчика параллельно отправляют каждое письмо ровно один раз', async () => {
    const mailer = memoryMailer({
      // Отправка не мгновенная: обработчики успевают перемешаться
      beforeSend: () => new Promise((resolve) => setTimeout(resolve, 2)),
    })
    const recipients = Array.from({ length: 25 }, (_, index) => `user${index}@example.ru`)
    for (const to of recipients) await enqueueMail(db, testMail(to), T0)

    const run = () => processOutbox({ db, mailer, ...settings, now: () => T0, batchSize: 4 })
    // Каждый обработчик крутит проходы, пока очередь не опустеет
    const worker = async () => {
      while ((await run()).claimed > 0) {}
    }
    await Promise.all([worker(), worker(), worker()])

    expect(mailer.sent.map((mail) => mail.to).sort()).toEqual([...recipients].sort())
    const rows = await db.select().from(mailOutbox)
    expect(rows.every((row) => row.status === 'sent' && row.attempts === 1)).toBe(true)
  })

  it('письмо, которое держит другой обработчик, не берётся, пока аренда не истекла', async () => {
    const repo = outboxRepo(db)
    const { id } = await enqueueMail(db, testMail(), T0)
    const [first] = await repo.claimDue({ now: T0, limit: 10, maxAttempts: 3 })
    expect(first?.id).toBe(id)
    expect(await repo.claimDue({ now: after(MINUTE), limit: 10, maxAttempts: 3 })).toEqual([])

    // Обработчик упал посреди отправки: после аренды письмо берёт другой
    const [second] = await repo.claimDue({
      now: after(SENDING_LEASE_MS),
      limit: 10,
      maxAttempts: 3,
    })
    expect(second).toMatchObject({ id, attempts: 2 })
    expect(second?.claimId).not.toBe(first?.claimId)

    // Первый очнулся: его итог не переписывает письмо, которое уже у второго
    await repo.markSent(first as NonNullable<typeof first>, {
      now: after(SENDING_LEASE_MS),
      messageId: 'x',
    })
    expect(await rowOf(id)).toMatchObject({ status: 'sending', claimId: second?.claimId })
  })

  it('застрявшее в отправке письмо без попыток — failed, а не вечная аренда', async () => {
    const repo = outboxRepo(db)
    const { id } = await enqueueMail(db, testMail(), T0)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await repo.claimDue({ now: after(attempt * SENDING_LEASE_MS), limit: 10, maxAttempts: 3 })
    }
    expect(await rowOf(id)).toMatchObject({ status: 'sending', attempts: 3 })
    await processOutbox({
      db,
      mailer: memoryMailer(),
      ...settings,
      now: () => after(3 * SENDING_LEASE_MS),
    })
    expect(await rowOf(id)).toMatchObject({ status: 'failed' })
    expect((await rowOf(id)).lastError).toContain('попытки кончились')
  })

  it('повтор вручную: failed → pending с попытками с нуля; sent и sending — нельзя', async () => {
    const repo = outboxRepo(db)
    const mailer = memoryMailer({
      beforeSend: () => {
        throw new MailSendError('нет', true)
      },
    })
    const { id } = await enqueueMail(db, testMail(), T0)
    await processOutbox({ db, mailer, ...settings, now: () => T0 })
    expect(await repo.retry(id, after(MINUTE))).toBe('queued')
    expect(await rowOf(id)).toMatchObject({
      status: 'pending',
      attempts: 0,
      nextAttemptAt: after(MINUTE),
    })

    await processOutbox({ db, mailer: memoryMailer(), ...settings, now: () => after(MINUTE) })
    expect(await repo.retry(id, after(2 * MINUTE))).toBe('busy')
    expect(await repo.retry(crypto.randomUUID(), T0)).toBe('not_found')
  })
})

describe('аренда на одно письмо', () => {
  const settings = { maxAttempts: 3, retentionDays: 30 }

  it('пачка дольше аренды: письмо, которое взял второй обработчик, первый не отправляет', async () => {
    let clock = T0
    const now = () => clock
    let second: Awaited<ReturnType<typeof processOutbox>> | undefined
    const mailer = memoryMailer({
      beforeSend: async (mail) => {
        // Каждое письмо «отправляется» 3 минуты: пачка из трёх идёт дольше 5-минутной аренды
        clock = new Date(clock.getTime() + 3 * MINUTE)
        if (mail.to === 'b@example.ru' && second === undefined) {
          // Посреди второго письма просыпается второй обработчик (второй процесс API): аренда
          // третьего письма, выданная при заборе пачки, уже истекла
          second = await processOutbox({ db, mailer, ...settings, now })
        }
      },
    })
    // Порядок в очереди задан временем постановки: a, b, c
    for (const [index, to] of ['a@example.ru', 'b@example.ru', 'c@example.ru'].entries()) {
      await enqueueMail(db, testMail(to), after(index - 3))
    }

    const first = await processOutbox({ db, mailer, ...settings, now })

    // Каждое письмо ушло ровно один раз: третье отправил второй обработчик, первый его пропустил
    expect(mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'a@example.ru',
      'b@example.ru',
      'c@example.ru',
    ])
    expect(first).toMatchObject({ claimed: 3, sent: 2, skipped: 1 })
    expect(second).toMatchObject({ claimed: 1, sent: 1, skipped: 0 })
    const rows = await db.select().from(mailOutbox)
    expect(rows.every((row) => row.status === 'sent')).toBe(true)
  })

  it('аренда продлевается перед каждым письмом: пока оно отправляется, его не берут', async () => {
    const repo = outboxRepo(db)
    const { id } = await enqueueMail(db, testMail(), T0)
    const [mail] = await repo.claimDue({ now: T0, limit: 10, maxAttempts: 3 })
    if (!mail) throw new Error('письмо не взялось')
    // Письмо ждало своей очереди в пачке 4 минуты и продлено перед отправкой
    expect(await repo.renewLease(mail, after(4 * MINUTE))).toBe(true)
    // Аренда от забора истекла бы в T0 + 5 мин, продлённая — в T0 + 9 мин
    expect(await repo.claimDue({ now: after(6 * MINUTE), limit: 10, maxAttempts: 3 })).toEqual([])
    const [other] = await repo.claimDue({ now: after(9 * MINUTE), limit: 10, maxAttempts: 3 })
    expect(other?.id).toBe(id)
    // Письмо уже у другого: продлить его старой арендой нельзя
    expect(await repo.renewLease(mail, after(9 * MINUTE))).toBe(false)
  })
})

describe('сбои сервера и базы', () => {
  const settings = { maxAttempts: 3, retentionDays: 30 }

  it.each(['auth', 'tls', 'connection', 'dns'] as const)(
    'сбой сервера (%s): проход прерывается, остальные письма ждут без траты попыток',
    async (step) => {
      let logins = 0
      const mailer = memoryMailer({
        beforeSend: () => {
          logins += 1
          throw new MailSendError('Сервер не принял логин или пароль', false, step)
        },
      })
      const ids: string[] = []
      for (const [index, to] of ['a@example.ru', 'b@example.ru', 'c@example.ru'].entries()) {
        ids.push((await enqueueMail(db, testMail(to), after(index - 3))).id)
      }
      const result = await processOutbox({ db, mailer, ...settings, now: () => T0 })

      // Сервер спросили один раз, а не по разу на каждое письмо пачки
      expect(logins).toBe(1)
      expect(result).toMatchObject({ claimed: 3, retry: 1, serverDown: true })
      expect(await rowOf(ids[0] as string)).toMatchObject({ status: 'pending', attempts: 1 })
      for (const id of ids.slice(1)) {
        expect(await rowOf(id)).toMatchObject({ status: 'pending', attempts: 0, claimId: null })
      }
    },
  )

  it('сбой письма (не сервера) — остальные письма пачки уходят', async () => {
    const mailer = memoryMailer({
      beforeSend: (mail) => {
        if (mail.to === 'a@example.ru') throw new MailSendError('Ящик переполнен', false, 'send')
      },
    })
    await enqueueMail(db, testMail('a@example.ru'), after(-2))
    await enqueueMail(db, testMail('b@example.ru'), after(-1))
    const result = await processOutbox({ db, mailer, ...settings, now: () => T0 })
    expect(result).toMatchObject({ claimed: 2, sent: 1, retry: 1, serverDown: false })
  })

  it('письмо ушло, а записать «отправлено» не вышло — это не неудачная попытка, письмо не уходит снова', async () => {
    const mailer = memoryMailer()
    const first = await enqueueMail(db, testMail('a@example.ru'), T0)
    const second = await enqueueMail(db, testMail('b@example.ru'), after(1))
    // Настоящий сбой базы на записи статуса sent: триггер отказывает такому UPDATE
    await db.execute(
      sql.raw(`CREATE FUNCTION fail_mail_sent() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.status = 'sent' THEN RAISE EXCEPTION 'база недоступна'; END IF;
          RETURN NEW;
        END $$`),
    )
    await db.execute(
      sql.raw(
        'CREATE TRIGGER fail_mail_sent BEFORE UPDATE ON mail_outbox FOR EACH ROW EXECUTE FUNCTION fail_mail_sent()',
      ),
    )
    const logs: string[] = []
    try {
      const result = await processOutbox({
        db,
        mailer,
        ...settings,
        now: () => after(MINUTE),
        log: (message) => logs.push(message),
      })
      expect(result).toMatchObject({ claimed: 2, sent: 1, retry: 0, aborted: true })
    } finally {
      await db.execute(sql.raw('DROP TRIGGER fail_mail_sent ON mail_outbox'))
      await db.execute(sql.raw('DROP FUNCTION fail_mail_sent()'))
    }
    expect(mailer.sent.map((mail) => mail.to)).toEqual(['a@example.ru'])
    // Ушедшее письмо не вернулось в очередь как неудачное: держит аренду, ошибки базы в нём нет
    expect(await rowOf(first.id)).toMatchObject({ status: 'sending', attempts: 1, lastError: null })
    // Второе письмо пачки отпущено без траты попытки
    expect(await rowOf(second.id)).toMatchObject({ status: 'pending', attempts: 0 })
    expect(logs.join('\n')).toContain('записать это в базу не вышло')

    // Следующий проход до конца аренды первое письмо снова не шлёт
    await processOutbox({ db, mailer, ...settings, now: () => after(2 * MINUTE) })
    expect(mailer.sent.map((mail) => mail.to).sort()).toEqual(['a@example.ru', 'b@example.ru'])
  })
})

describe('письма с одноразовой ссылкой', () => {
  const settings = { maxAttempts: 3, retentionDays: 30 }
  const TOKEN = 'SECRET-TOKEN-0'
  const resetMail = (to = 'anna@example.ru') => ({
    template: 'password-reset' as const,
    data: {
      name: 'Анна',
      url: `https://admin.example.ru/reset-password?token=${TOKEN}`,
      expiresInMinutes: 60,
    },
    to,
  })
  const rowText = async (id: string) => JSON.stringify(await rowOf(id))

  it('срок письма — срок ссылки от постановки в очередь', async () => {
    const reset = await enqueueMail(db, resetMail(), T0)
    const plain = await enqueueMail(db, testMail(), T0)
    expect((await rowOf(reset.id)).expiresAt).toEqual(after(60 * MINUTE))
    expect((await rowOf(plain.id)).expiresAt).toBeNull()
  })

  it('после отправки ссылки с токеном в базе нет', async () => {
    const mailer = memoryMailer()
    const { id } = await enqueueMail(db, resetMail(), T0)
    expect(await rowText(id)).toContain(TOKEN)
    await processOutbox({ db, mailer, ...settings, now: () => after(MINUTE) })

    expect(mailer.sent[0]?.text).toContain(TOKEN)
    expect(await rowOf(id)).toMatchObject({ status: 'sent', data: null })
    expect(await rowText(id)).not.toContain(TOKEN)
  })

  it('не отправилось окончательно — ссылка стёрта, повторить нельзя', async () => {
    const repo = outboxRepo(db)
    const mailer = memoryMailer({
      beforeSend: () => {
        throw new MailSendError('Сервер не принял адрес получателя', true, 'send')
      },
    })
    const { id } = await enqueueMail(db, resetMail(), T0)
    await processOutbox({ db, mailer, ...settings, now: () => T0 })

    expect(await rowOf(id)).toMatchObject({ status: 'failed', data: null })
    expect(await rowText(id)).not.toContain(TOKEN)
    expect(await repo.retry(id, after(MINUTE))).toBe('gone')
    const listed = (await repo.list({ now: after(MINUTE) })).find((row) => row.id === id)
    expect(listed?.canRetry).toBe(false)
  })

  it('письмо без секрета после неудачи данные хранит: его можно повторить', async () => {
    const repo = outboxRepo(db)
    const mailer = memoryMailer({
      beforeSend: () => {
        throw new MailSendError('нет', true, 'send')
      },
    })
    const { id } = await enqueueMail(db, testMail(), T0)
    await processOutbox({ db, mailer, ...settings, now: () => T0 })
    expect((await rowOf(id)).data).not.toBeNull()
    const listed = (await repo.list({ now: T0 })).find((row) => row.id === id)
    expect(listed?.canRetry).toBe(true)
  })

  it('ссылка истекла, пока письмо ждало (SMTP лежал), — письмо не уходит, ссылка стёрта', async () => {
    let down = true
    const mailer = memoryMailer({
      beforeSend: () => {
        if (down) throw new MailSendError('SMTP недоступен')
      },
    })
    const { id } = await enqueueMail(db, resetMail(), T0)
    await processOutbox({ db, mailer, ...settings, now: () => T0 })
    expect(await rowOf(id)).toMatchObject({ status: 'pending', attempts: 1 })

    // SMTP ожил, но через час с лишним: ссылка в письме уже не работает
    down = false
    await processOutbox({ db, mailer, ...settings, now: () => after(61 * MINUTE) })
    expect(mailer.sent).toHaveLength(0)
    expect(await rowOf(id)).toMatchObject({
      status: 'failed',
      data: null,
      lastError: LINK_EXPIRED_ERROR,
    })
    expect(await outboxRepo(db).retry(id, after(62 * MINUTE))).toBe('gone')
  })

  it('ссылка истекла посреди пачки — письмо не уходит', async () => {
    let clock = T0
    const mailer = memoryMailer({
      beforeSend: () => {
        // Первое письмо пачки отправляется долго: срок ссылки второго за это время выходит
        clock = after(61 * MINUTE)
      },
    })
    await enqueueMail(db, testMail('first@example.ru'), after(-1))
    const { id } = await enqueueMail(db, resetMail('second@example.ru'), T0)
    await processOutbox({ db, mailer, ...settings, now: () => clock })

    expect(mailer.sent.map((mail) => mail.to)).toEqual(['first@example.ru'])
    expect(await rowOf(id)).toMatchObject({ status: 'failed', data: null })
  })
})

describe('очистка', () => {
  it('удаляет письма старше срока в любом статусе, свежие оставляет', async () => {
    const repo = outboxRepo(db)
    const DAY = 24 * 60 * MINUTE
    const insert = (values: Partial<typeof mailOutbox.$inferInsert>) =>
      db
        .insert(mailOutbox)
        .values({ template: 'mail-test', data: {}, recipient: 'a@b.ru', ...values })
        .returning({ id: mailOutbox.id })
        .then(([row]) => row?.id as string)

    const oldSent = await insert({ status: 'sent', data: null, sentAt: after(-31 * DAY) })
    const freshSent = await insert({ status: 'sent', data: null, sentAt: after(-29 * DAY) })
    const oldFailed = await insert({ status: 'failed', lastAttemptAt: after(-31 * DAY) })
    // Неотправленное без попыток (ссылка истекла, пока почта была выключена) — по времени постановки
    const oldFailedNeverTried = await insert({ status: 'failed', createdAt: after(-31 * DAY) })
    // Почта была выключена или обработчик не работал: письмо так и не ушло, но и не лежит вечно
    const oldPending = await insert({ status: 'pending', createdAt: after(-60 * DAY) })
    const freshPending = await insert({ status: 'pending', createdAt: after(-29 * DAY) })

    expect(await repo.cleanup({ now: T0, retentionDays: 30 })).toBe(4)
    const left = (await db.select({ id: mailOutbox.id }).from(mailOutbox)).map((row) => row.id)
    expect(left.sort()).toEqual([freshSent, freshPending].sort())
    for (const id of [oldSent, oldFailed, oldFailedNeverTried, oldPending]) {
      expect(left).not.toContain(id)
    }
  })
})
