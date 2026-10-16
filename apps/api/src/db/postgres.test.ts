import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { memoryMailer } from '../mail/memory-mailer'
import { leadsRepo } from '../modules/leads/repo'
import { createTestApi, sendQueue } from '../testing'
import { createDb } from './client'
import { migrateDb } from './migrate'
import { leads, pageRevisions } from './schema'

// API на настоящем драйвере PostgreSQL (node-postgres, как на сервере с DATABASE_URL), а не на
// встроенном PGlite. Docker и PostgreSQL на машине разработки нет, поэтому сервером служит
// PGlite за сервером протокола Postgres (@electric-sql/pglite-socket): драйвер ходит по TCP,
// разбирает ответы и типы, держит пул и транзакции ровно как с настоящим Postgres. Отличие одно —
// сервер выполняет запросы по очереди, а не параллельно. Проверяем то, чем драйверы расходятся:
// миграции, транзакции, db.execute(...).rows (сырые запросы), timestamptz и jsonb, bigint

const pglite = new PGlite()
// Порт 0 — свободный: тест не мешает ни pnpm dev, ни соседним файлам тестов
const server = new PGLiteSocketServer({ db: pglite, port: 0, maxConnections: 4 })
await server.start()
const url = `postgres://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`

const mailer = memoryMailer()
const api = await createTestApi({
  mail: mailer,
  database: { kind: 'postgres', url, maxConnections: 4 },
})
afterAll(async () => {
  await api.close()
  // Сервер протокола разбирает закрытые соединения в setImmediate и при этом обращается к PGlite.
  // Закрыть PGlite раньше — его обработчик упадёт уже после тестов (необработанная ошибка vitest)
  const deadline = Date.now() + 5000
  while (server.getStats().activeConnections > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await server.stop()
  await new Promise((resolve) => setImmediate(resolve))
  await pglite.close()
})

const owner = await api.loginAs('owner')
const json = { ...owner.headers, 'content-type': 'application/json' }

describe('API на драйвере node-postgres (DATABASE_URL)', () => {
  it('отвечает «база жива» и применил миграции', async () => {
    const res = await api.app.request('/api/health/ready')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', db: 'up' })
    const tables = await pglite.query<{ name: string }>(
      `select table_name as name from information_schema.tables where table_schema = 'public'`,
    )
    expect(tables.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(['sites', 'pages', 'leads', 'mail_outbox', 'site_builds']),
    )
  })

  it('миграции повторно ничего не ломают: старт API на уже размеченной базе', async () => {
    const second = createDb({ kind: 'postgres', url, maxConnections: 1 })
    try {
      await migrateDb(second.db)
    } finally {
      await second.close()
    }
  })

  it('сайт, черновик, публикация с историей (транзакция) и снимок для рендерера', async () => {
    const created = await api.app.request('/api/sites', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name: 'Сайт на Postgres' }),
    })
    expect(created.status).toBe(201)
    const { id: siteId } = (await created.json()) as { id: string }

    const blocks = [
      {
        id: 'lead',
        type: 'form',
        props: {
          title: 'Заявка',
          fields: [
            { name: 'name', type: 'name', label: 'Имя', required: true },
            { name: 'email', type: 'email', label: 'Почта' },
          ],
          policyUrl: '/privacy',
        },
      },
    ]
    const saved = await api.app.request(`/api/sites/${siteId}/pages/index`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ title: 'Главная', content: { blocks } }),
    })
    expect(saved.status).toBe(200)
    for (let i = 0; i < 2; i += 1) {
      const published = await api.app.request(`/api/sites/${siteId}/pages/index/publish`, {
        method: 'POST',
        headers: owner.headers,
      })
      expect(published.status).toBe(200)
    }
    const versions = await api.db
      .select({ version: pageRevisions.version })
      .from(pageRevisions)
      .where(eq(pageRevisions.siteId, siteId))
    expect(versions.map((row) => row.version).sort()).toEqual([1, 2])

    const snapshot = await api.app.request(`/api/sites/${siteId}/snapshot`)
    expect(snapshot.status).toBe(200)
    const body = (await snapshot.json()) as { pages: { slug: string; content: unknown }[] }
    // jsonb вернулся объектом, со значениями по умолчанию, которые дописала схема блока
    expect(body.pages).toMatchObject([{ slug: 'index', title: 'Главная', content: { blocks } }])

    // Заявка: транзакция «заявка + письма», сырые запросы выгрузки и сумма объёма (bigint)
    const lead = await api.app.request(`/api/forms/${siteId}/index/lead`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://site.example.ru',
        accept: 'application/json',
      },
      body: new URLSearchParams({ name: 'Анна', email: 'anna@example.ru', consent: 'yes' }),
    })
    expect(lead.status).toBe(200)
    const repo = leadsRepo(api.db)
    expect(await repo.exportLabels(siteId)).toEqual(['Имя', 'Почта'])
    const [batch] = await repo.exportBatch(siteId)
    // Курсор выгрузки — время текстом, как его отдаёт Postgres (пояс сессии любой: курсор
    // возвращается в запрос как ::timestamptz и сравнивается как время, а не как строка)
    expect(batch?.cursorAt).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}(:\d{2})?$/,
    )
    expect(await repo.storedBytesSince(siteId, new Date(Date.now() - 60_000))).toBeGreaterThan(0)
    const [row] = await api.db.select().from(leads).where(eq(leads.siteId, siteId))
    expect(row?.createdAt).toBeInstanceOf(Date)
    expect(row?.data).toEqual([
      { name: 'name', label: 'Имя', type: 'name', value: 'Анна' },
      { name: 'email', label: 'Почта', type: 'email', value: 'anna@example.ru' },
    ])

    // Очередь писем: аренда, отметки «отправлено» — через тот же драйвер
    await sendQueue(api)
    expect(mailer.sent.map((mail) => mail.to).sort()).toEqual(
      ['anna@example.ru', owner.user.email].sort(),
    )
  })

  it('CSV заявок отдаётся потоком и на этом драйвере', async () => {
    const [site] = (await (
      await api.app.request('/api/sites', { headers: owner.headers })
    ).json()) as { id: string; name: string }[]
    expect(site).toBeDefined()
    const res = await api.app.request(`/api/sites/${site?.id}/leads/export`, {
      headers: owner.headers,
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
  })
})
