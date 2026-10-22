import { type InstallationFacts, SITE_NAME_MAX } from '@averra/schema'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { mailOutbox, notificationOutbox, notificationWatch, siteBuilds } from '../db/schema'
import { memoryMailer } from '../mail/memory-mailer'
import { createTestApi, sendNotifications, sendQueue } from '../testing'
import { renderNotification } from './events'
import { bindChat, fakeTelegram, jsonHeaders, saveBot } from './testing/scenario'
import {
  failedBuilds,
  installationLabel,
  lastMailSentAt,
  runServiceWatch,
  type ServiceReading,
  serviceSignals,
} from './watch'

// Служебные события — по переходу состояния: из тех же фактов, что у «Состояния», в уведомление
// «проблема» один раз, пока она есть, и «снова в порядке», когда ушла. Не на каждом круге

const now = new Date('2026-10-20T12:00:00.000Z')
/** Когда проблему объявили: час назад */
const raised = new Date(now.getTime() - 60 * 60 * 1000)
const context = { installation: 'Ремонт (remont.ru)', adminUrl: 'https://admin.remont.ru' }

const GB = 1024 ** 3

function facts(overrides: Partial<InstallationFacts> = {}): InstallationFacts {
  return {
    version: '1.0.0',
    checkedAt: now.toISOString(),
    db: { up: true, migrations: 17, serviceDatabases: [] },
    backup: { enabled: true, unreadable: false, last: null, lastOk: null },
    update: null,
    updateUnreadable: false,
    publish: { enabled: true, last: null, failedSites: 0 },
    mail: {
      enabled: true,
      reason: null,
      failedRecent: 0,
      pending: 0,
      failing: 0,
      failingSince: null,
    },
    disk: [{ label: 'данные (медиатека и сайты)', freeBytes: 20 * GB, totalBytes: 40 * GB }],
    ...overrides,
  }
}

const failedBackup = {
  name: '20261020-030000-scheduled',
  kind: 'scheduled' as const,
  startedAt: '2026-10-20T03:00:00Z',
  finishedAt: '2026-10-20T03:05:00Z',
  ok: false,
  verified: false,
  dbBytes: null,
  mediaBytes: null,
  remote: 'off' as const,
  error: 'не хватило места на диске',
}

describe('сигналы из фактов', () => {
  it('бэкап, диск, сборка и почта — свои ключи; в порядке — сигналов нет', () => {
    expect(serviceSignals(facts(), [], context, now).signals).toEqual([])
    const reading = serviceSignals(
      facts({
        backup: { enabled: true, unreadable: false, last: failedBackup, lastOk: null },
        disk: [{ label: 'данные (медиатека и сайты)', freeBytes: GB / 2, totalBytes: 40 * GB }],
        mail: {
          enabled: true,
          reason: null,
          failedRecent: 0,
          pending: 3,
          failing: 3,
          failingSince: new Date(now.getTime() - 20 * 60 * 1000).toISOString(),
        },
      }),
      [{ siteId: 'site-1', siteName: 'Ремонт', error: 'Astro: ошибка сборки' }],
      context,
      now,
    )
    expect(reading.signals.map((signal) => signal.key)).toEqual([
      'backup.failed',
      'disk.low:данные (медиатека и сайты)',
      'build.failed:site-1',
      'mail.down',
    ])
    expect(reading.signals[0]?.data).toMatchObject({
      installation: 'Ремонт (remont.ru)',
      backup: failedBackup.name,
      error: failedBackup.error,
      url: 'https://admin.remont.ru/status',
    })
    expect(reading.signals[1]?.data).toMatchObject({ free: '0,5 ГБ' })
  })

  it('почта с ошибкой меньше 15 минут — ещё не «не работает»', () => {
    const mail = {
      enabled: true,
      reason: null,
      failedRecent: 0,
      pending: 1,
      failing: 1,
      failingSince: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    }
    expect(serviceSignals(facts({ mail }), [], context, now).signals).toEqual([])
  })

  it('не читается файл бэкапов или диск не ответил — состояние неизвестно, а не «прошло»', () => {
    const reading = serviceSignals(
      facts({ backup: { enabled: true, unreadable: true, last: null, lastOk: null }, disk: [] }),
      [],
      context,
      now,
    )
    expect(reading.unknown('backup.failed', raised)).toBe(true)
    expect(reading.unknown('disk.low:данные (медиатека и сайты)', raised)).toBe(true)
  })

  it('гистерезис: диск у порога и письма с ошибкой в очереди — «снова в порядке» рано', () => {
    const key = 'disk.low:данные (медиатека и сайты)'
    // Чуть выше порога 1 ГБ: проблемы уже нет, но и «хватает» ещё не говорим
    const near = serviceSignals(
      facts({
        disk: [{ label: 'данные (медиатека и сайты)', freeBytes: 1.1 * GB, totalBytes: 10 * GB }],
      }),
      [],
      context,
      now,
    )
    expect(near.signals).toEqual([])
    expect(near.unknown(key, raised)).toBe(true)
    const plenty = serviceSignals(facts(), [], context, now)
    expect(plenty.unknown(key, raised)).toBe(false)
    // Ошибка письма свежая (меньше 15 минут) — не «не работает», но и не «снова работает»
    const mail = {
      enabled: true,
      reason: null,
      failedRecent: 0,
      pending: 1,
      failing: 1,
      failingSince: new Date(now.getTime() - 60 * 1000).toISOString(),
    }
    expect(
      serviceSignals(facts({ mail }), [], context, now, now).unknown('mail.down', raised),
    ).toBe(true)
  })

  it('«почта снова работает» — только когда письмо ушло после объявления проблемы', () => {
    const at = (offsetMs: number) => new Date(raised.getTime() + offsetMs)
    // Очередь без писем с ошибкой: они могли уйти в failed, исчерпав попытки, а не уйти адресату
    const clean = facts()
    expect(serviceSignals(clean, [], context, now, null).unknown('mail.down', raised)).toBe(true)
    expect(serviceSignals(clean, [], context, now, at(-1000)).unknown('mail.down', raised)).toBe(
      true,
    )
    expect(serviceSignals(clean, [], context, now, at(1000)).unknown('mail.down', raised)).toBe(
      false,
    )
    // Письмо ушло, но в очереди снова письма с ошибкой — рано
    const failing = facts({
      mail: { ...clean.mail, pending: 1, failing: 1, failingSince: at(2000).toISOString() },
    })
    expect(serviceSignals(failing, [], context, now, at(1000)).unknown('mail.down', raised)).toBe(
      true,
    )
  })

  it('«места снова хватает» не повторяет объём из момента, когда его не хватало', () => {
    const message = renderNotification('disk.low', {
      state: 'resolved',
      installation: 'Ремонт',
      url: 'https://admin.remont.ru/status',
      disk: 'данные',
      free: '0,5 ГБ',
    })
    expect(message.title).toBe('Ремонт: места на диске снова хватает')
    expect(JSON.stringify(message)).not.toContain('0,5 ГБ')
  })

  it('название установки — сайт и домен', () => {
    expect(installationLabel('Ремонт', 'https://remont.ru')).toBe('Ремонт (remont.ru)')
    expect(installationLabel('Ремонт', undefined)).toBe('Ремонт')
  })
})

describe('переходы состояния', async () => {
  const fake = await fakeTelegram()
  const mailer = memoryMailer()
  const api = await createTestApi({ mail: mailer, telegramApiUrl: fake.url })
  afterAll(async () => {
    await api.close()
    await fake.close()
  })
  const owner = await api.loginAs('owner')

  expect((await saveBot(api, owner.headers)).status).toBe(200)
  const { chat } = await bindChat(api, fake, owner.headers, {
    chat: { id: 4004, type: 'private', first_name: 'Студия' },
  })
  await api.app.request('/api/notifications/service/email', {
    method: 'PUT',
    headers: jsonHeaders(owner.headers),
    body: JSON.stringify({
      recipients: [{ address: 'ops@studio.ru', events: ['backup.failed', 'mail.down'] }],
    }),
  })

  const failing = facts({
    backup: { enabled: true, unreadable: false, last: failedBackup, lastOk: null },
  })
  const round = (input: InstallationFacts) =>
    runServiceWatch(api.db, api.notifyDeps(), serviceSignals(input, [], context, now), now)

  it('проблема — одно уведомление, сколько бы кругов она ни длилась', async () => {
    expect(await round(failing)).toEqual({ raised: 1, resolved: 0, failed: 0 })
    expect(await round(failing)).toEqual({ raised: 0, resolved: 0, failed: 0 })
    expect(await round(failing)).toEqual({ raised: 0, resolved: 0, failed: 0 })
    const watched = await api.db.select().from(notificationWatch)
    expect(watched.map((row) => row.key)).toEqual(['backup.failed'])

    await sendNotifications(api)
    await sendQueue(api)
    const messages = fake
      .messagesTo(String(chat.id))
      .filter((m) => m.text.includes('бэкап не прошёл'))
    expect(messages).toHaveLength(1)
    expect(messages[0]?.text).toContain('<b>Ремонт (remont.ru): бэкап не прошёл</b>')
    expect(messages[0]?.text).toContain('не хватило места на диске')
    const mail = mailer.sent.filter((sent) => sent.to === 'ops@studio.ru')
    expect(mail.map((sent) => sent.subject)).toEqual(['Ремонт (remont.ru): бэкап не прошёл'])
  })

  it('ушла — «снова в порядке» один раз; файл не читается — ничего не решаем', async () => {
    const unreadable = facts({
      backup: { enabled: true, unreadable: true, last: null, lastOk: null },
    })
    expect(await round(unreadable)).toEqual({ raised: 0, resolved: 0, failed: 0 })
    expect(await round(facts())).toEqual({ raised: 0, resolved: 1, failed: 0 })
    expect(await round(facts())).toEqual({ raised: 0, resolved: 0, failed: 0 })
    await sendNotifications(api)
    expect(fake.messagesTo(String(chat.id)).at(-1)?.text).toContain('бэкапы снова проходят')
  })

  it('«почта не работает» по почте не шлём — только в Telegram', async () => {
    await api.db.delete(notificationOutbox)
    const before = (await api.db.select().from(mailOutbox)).length
    const mailDown = facts({
      mail: {
        enabled: true,
        reason: null,
        failedRecent: 0,
        pending: 2,
        failing: 2,
        failingSince: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      },
    })
    expect(await round(mailDown)).toEqual({ raised: 1, resolved: 0, failed: 0 })
    expect(await api.db.select().from(mailOutbox)).toHaveLength(before)
    const queued = await api.db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.event, 'mail.down'))
    expect(queued.map((row) => row.address)).toEqual([String(chat.id)])
  })

  it('письма ушли в failed, ни одно не отправлено — «почта снова работает» не приходит', async () => {
    // Попытки кончились (~12 часов): писем с ошибкой в очереди нет, но почта не починилась
    const exhausted = facts({
      mail: {
        enabled: true,
        reason: null,
        failedRecent: 2,
        pending: 0,
        failing: 0,
        failingSince: null,
      },
    })
    const sentBefore = new Date(now.getTime() - 60 * 1000)
    const watch = (sentAt: Date | null) =>
      runServiceWatch(
        api.db,
        api.notifyDeps(),
        serviceSignals(exhausted, [], context, now, sentAt),
        now,
      )
    expect(await watch(sentBefore)).toEqual({ raised: 0, resolved: 0, failed: 0 })
    expect(await watch(null)).toEqual({ raised: 0, resolved: 0, failed: 0 })
    const keys = (await api.db.select().from(notificationWatch)).map((row) => row.key)
    expect(keys).toContain('mail.down')

    // Письмо ушло после объявления (первая проверка отправила письмо о бэкапе) — снова работает
    const sentAt = await lastMailSentAt(api.db)
    expect(sentAt?.getTime()).toBeGreaterThan(now.getTime())
    expect(await watch(sentAt)).toEqual({ raised: 0, resolved: 1, failed: 0 })
    await sendNotifications(api)
    // «Не работает» и «снова работает» поставлены с одним временем круга — порядок не важен
    const texts = fake.messagesTo(String(chat.id)).map((message) => message.text)
    expect(texts.filter((text) => text.includes('почта снова работает'))).toHaveLength(1)
  })
})

describe('служебные без получателей', async () => {
  const api = await createTestApi({ mail: memoryMailer() })
  afterAll(api.close)
  const owner = await api.loginAs('owner')

  it('проблема, о которой сказать некому, не запоминается: получатель узнает о ней позже', async () => {
    const disk = facts({
      disk: [{ label: 'данные (медиатека и сайты)', freeBytes: GB / 4, totalBytes: 40 * GB }],
    })
    const reading = serviceSignals(disk, [], context, now)
    expect(await runServiceWatch(api.db, api.notifyDeps(), reading, now)).toEqual({
      raised: 0,
      resolved: 0,
      failed: 0,
    })
    expect(await api.db.select().from(notificationWatch)).toEqual([])
    await api.app.request('/api/notifications/service/email', {
      method: 'PUT',
      headers: jsonHeaders(owner.headers),
      body: JSON.stringify({ recipients: [{ address: 'late@studio.ru', events: ['disk.low'] }] }),
    })
    expect(await runServiceWatch(api.db, api.notifyDeps(), reading, now)).toEqual({
      raised: 1,
      resolved: 0,
      failed: 0,
    })
    // Ушла — и забыта, чтобы не мешать остальным проверкам
    expect(
      await runServiceWatch(
        api.db,
        api.notifyDeps(),
        serviceSignals(facts(), [], context, now),
        now,
      ),
    ).toEqual({ raised: 0, resolved: 1, failed: 0 })
  })
})

describe('длинные названия и сбой одного перехода', async () => {
  const mailer = memoryMailer()
  const api = await createTestApi({ mail: mailer })
  afterAll(api.close)
  const owner = await api.loginAs('owner')
  await api.app.request('/api/notifications/service/email', {
    method: 'PUT',
    headers: jsonHeaders(owner.headers),
    body: JSON.stringify({
      recipients: [
        { address: 'ops@studio.ru', events: ['backup.failed', 'disk.low', 'build.failed'] },
      ],
    }),
  })
  // Название сайта на пределе и длинный домен: заголовок «сборка сайта упала» длиннее 200 знаков
  const longContext = {
    installation: installationLabel('Р'.repeat(SITE_NAME_MAX), `https://${'d'.repeat(60)}.ru`),
    adminUrl: 'https://admin.remont.ru',
  }
  const longBuild = { siteId: 'site-long', siteName: 'С'.repeat(SITE_NAME_MAX), error: 'Astro' }
  const failingAll = facts({
    backup: { enabled: true, unreadable: false, last: failedBackup, lastOk: null },
  })

  it('заголовок длиннее предела письма обрезается, а не роняет круг', async () => {
    const reading = serviceSignals(failingAll, [longBuild], longContext, now)
    expect(await runServiceWatch(api.db, api.notifyDeps(), reading, now)).toEqual({
      raised: 2,
      resolved: 0,
      failed: 0,
    })
    await sendQueue(api)
    const subjects = mailer.sent.map((sent) => sent.subject)
    expect(subjects).toHaveLength(2)
    const build = subjects.find((subject) => subject.endsWith('…'))
    expect(build?.length).toBe(200)
    expect(subjects.some((subject) => subject.includes('бэкап не прошёл'))).toBe(true)
    // Сборка снова прошла — «снова собирается» тоже длинное и тоже уходит
    expect(
      await runServiceWatch(
        api.db,
        api.notifyDeps(),
        serviceSignals(failingAll, [], longContext, now),
        now,
      ),
    ).toEqual({ raised: 0, resolved: 1, failed: 0 })
  })

  it('сбой одного перехода откатывает только его: остальные уходят, он — на следующем круге', async () => {
    await api.db.delete(notificationWatch)
    const failures: string[] = []
    const reading: ServiceReading = {
      signals: [
        {
          key: 'disk.low:битый',
          event: 'disk.low',
          // Данные не пройдут схему события — как сломанный шаблон или канал
          data: { installation: 'Ремонт', url: 'javascript:alert(1)', disk: 'д', free: '1 ГБ' },
        },
        {
          key: 'build.failed:site-2',
          event: 'build.failed',
          data: { installation: 'Ремонт', url: 'https://admin.remont.ru/settings', siteName: 'Б' },
        },
      ],
      unknown: () => false,
    }
    expect(
      await runServiceWatch(api.db, api.notifyDeps(), reading, now, ({ key }) =>
        failures.push(key),
      ),
    ).toEqual({ raised: 1, resolved: 0, failed: 1 })
    expect(failures).toEqual(['disk.low:битый'])
    const watched = await api.db.select().from(notificationWatch)
    expect(watched.map((row) => row.key)).toEqual(['build.failed:site-2'])
    // Следующий круг пробует снова, уже объявленное не повторяет
    expect(await runServiceWatch(api.db, api.notifyDeps(), reading, now)).toEqual({
      raised: 0,
      resolved: 0,
      failed: 1,
    })
  })
})

describe('упавшие сборки из базы', async () => {
  const api = await createTestApi()
  afterAll(api.close)
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60 * 1000)

  it('считается последняя завершённая сборка: новая в очереди «упала» не снимает', async () => {
    const siteId = await api.createSite('Сайт сборок')
    const mine = async () => (await failedBuilds(api.db)).filter((b) => b.siteId === siteId)
    await api.db.insert(siteBuilds).values({
      siteId,
      status: 'failed',
      error: 'Astro: ошибка',
      requestedAt: at(0),
      finishedAt: at(1),
    })
    expect(await mine()).toEqual([{ siteId, siteName: 'Сайт сборок', error: 'Astro: ошибка' }])
    // Пересборка ждёт или идёт — проблема ещё есть, «снова собирается» рано
    await api.db.insert(siteBuilds).values({ siteId, status: 'running', requestedAt: at(2) })
    expect(await mine()).toHaveLength(1)
    await api.db.insert(siteBuilds).values({ siteId, status: 'queued', requestedAt: at(3) })
    expect(await mine()).toHaveLength(1)
    // Пересборка прошла — проблемы нет
    await api.db.insert(siteBuilds).values({
      siteId,
      status: 'succeeded',
      release: 'r1',
      requestedAt: at(4),
      finishedAt: at(5),
    })
    expect(await mine()).toEqual([])
  })
})
