import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'

// Проверяем SQL миграций на базе со старыми данными: migrateDb применил бы всё разом
// на пустую базу, и перенос данных остался бы непроверенным
async function applyMigration(client: PGlite, name: string) {
  const sql = readFileSync(new URL(`../../drizzle/${name}.sql`, import.meta.url), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) await client.exec(statement)
}

let client: PGlite | undefined
afterEach(async () => {
  await client?.close()
})

describe('миграция 0001_page_published_title', () => {
  it('считает текущий заголовок уже опубликованных страниц опубликованным', async () => {
    client = new PGlite()
    await applyMigration(client, '0000_init')
    await client.exec(`
      INSERT INTO sites (id, name, theme) VALUES ('00000000-0000-4000-8000-000000000001', 'Сайт', '{}');
      INSERT INTO pages (site_id, slug, title, draft, published) VALUES
        ('00000000-0000-4000-8000-000000000001', 'index', 'На сайте', '{"blocks":[]}', '{"blocks":[]}'),
        ('00000000-0000-4000-8000-000000000001', 'draft', 'Черновик', '{"blocks":[]}', NULL);
    `)

    await applyMigration(client, '0001_page_published_title')

    const { rows } = await client.query<{ slug: string; published_title: string | null }>(
      'SELECT slug, published_title FROM pages ORDER BY slug',
    )
    expect(rows).toEqual([
      { slug: 'draft', published_title: null },
      { slug: 'index', published_title: 'На сайте' },
    ])
  })
})

describe('миграция 0002_page_published_with_title', () => {
  const siteId = '00000000-0000-4000-8000-000000000001'

  it('дозаполняет заголовок опубликованных страниц и запрещает публикацию без него', async () => {
    client = new PGlite()
    await applyMigration(client, '0000_init')
    await applyMigration(client, '0001_page_published_title')
    // Такую строку могла оставить 0001 без переноса данных или ручная правка
    await client.exec(`
      INSERT INTO sites (id, name, theme) VALUES ('${siteId}', 'Сайт', '{}');
      INSERT INTO pages (site_id, slug, title, draft, published) VALUES
        ('${siteId}', 'index', 'На сайте', '{"blocks":[]}', '{"blocks":[]}');
    `)

    await applyMigration(client, '0002_page_published_with_title')

    const { rows } = await client.query<{ published_title: string | null }>(
      'SELECT published_title FROM pages',
    )
    expect(rows).toEqual([{ published_title: 'На сайте' }])
    await expect(client.exec(`UPDATE pages SET published_title = NULL`)).rejects.toThrow(
      /pages_published_with_title/,
    )
    await expect(
      client.exec(`
        INSERT INTO pages (site_id, slug, title, draft, published_title)
        VALUES ('${siteId}', 'half', 'Без содержимого', '{"blocks":[]}', 'Заголовок');
      `),
    ).rejects.toThrow(/pages_published_with_title/)
  })

  it('заголовок без опубликованного содержимого сбрасывает, а не падает на проверке', async () => {
    client = new PGlite()
    await applyMigration(client, '0000_init')
    await applyMigration(client, '0001_page_published_title')
    await client.exec(`
      INSERT INTO sites (id, name, theme) VALUES ('${siteId}', 'Сайт', '{}');
      INSERT INTO pages (site_id, slug, title, draft, published, published_title) VALUES
        ('${siteId}', 'half', 'Черновик', '{"blocks":[]}', NULL, 'Осталось от правки');
    `)

    await applyMigration(client, '0002_page_published_with_title')

    const { rows } = await client.query<{ published_title: string | null }>(
      'SELECT published_title FROM pages',
    )
    expect(rows).toEqual([{ published_title: null }])
  })
})

describe('миграция 0003_auth', () => {
  const siteId = '00000000-0000-4000-8000-000000000001'

  it('ложится на базу с контентом и держит роли проверками в базе', async () => {
    client = new PGlite()
    for (const name of [
      '0000_init',
      '0001_page_published_title',
      '0002_page_published_with_title',
    ]) {
      await applyMigration(client, name)
    }
    await client.exec(`
      INSERT INTO sites (id, name, theme) VALUES ('${siteId}', 'Сайт', '{}');
      INSERT INTO pages (site_id, slug, title, draft) VALUES ('${siteId}', 'index', 'Главная', '{"blocks":[]}');
    `)

    await applyMigration(client, '0003_auth')

    const { rows } = await client.query<{ slug: string }>('SELECT slug FROM pages')
    expect(rows).toEqual([{ slug: 'index' }])
    const { rows: users } = await client.query<{ id: string; role: string }>(
      `INSERT INTO users (name, email) VALUES ('Новый', 'new@example.test') RETURNING id, role`,
    )
    // Роль по умолчанию — участник без доступа: владельцем делают явно
    expect(users[0]?.role).toBe('member')
    await expect(client.exec(`UPDATE users SET role = 'admin'`)).rejects.toThrow(/users_role_valid/)
    await expect(
      client.exec(
        `INSERT INTO site_members (site_id, user_id, role) VALUES ('${siteId}', '${users[0]?.id}', 'owner')`,
      ),
    ).rejects.toThrow(/site_members_role_valid/)
    await expect(
      client.exec(`INSERT INTO users (name, email) VALUES ('Дубль', 'new@example.test')`),
    ).rejects.toThrow(/users_email_unique/)
  })
})

describe('миграция 0004_page_revisions', () => {
  const siteId = '00000000-0000-4000-8000-000000000001'

  it('даёт опубликованным страницам версию 1, неопубликованные не трогает', async () => {
    client = new PGlite()
    for (const name of [
      '0000_init',
      '0001_page_published_title',
      '0002_page_published_with_title',
      '0003_auth',
    ]) {
      await applyMigration(client, name)
    }
    await client.exec(`
      INSERT INTO sites (id, name, theme) VALUES ('${siteId}', 'Сайт', '{}');
      INSERT INTO pages (site_id, slug, title, draft, published, published_title, published_at) VALUES
        ('${siteId}', 'index', 'Черновой', '{"blocks":[{"id":"a"}]}', '{"blocks":[]}', 'На сайте', '2026-10-01T10:00:00Z'),
        ('${siteId}', 'draft', 'Черновик', '{"blocks":[]}', NULL, NULL, NULL);
    `)

    await applyMigration(client, '0004_page_revisions')

    const { rows } = await client.query<Record<string, unknown>>(`
      SELECT p.slug, r.site_id, r.version, r.title, r.content, r.published_by, r.published_by_token,
        r.published_at = p.published_at AS same_time
      FROM page_revisions r JOIN pages p ON p.id = r.page_id
    `)
    expect(rows).toEqual([
      {
        slug: 'index',
        site_id: siteId,
        version: 1,
        title: 'На сайте',
        content: { blocks: [] },
        published_by: null,
        published_by_token: null,
        same_time: true,
      },
    ])

    const { rows: page } = await client.query<{ id: string }>(
      `SELECT id FROM pages WHERE slug = 'index'`,
    )
    const pageId = page[0]?.id
    const insert = (version: number) => `
      INSERT INTO page_revisions (site_id, page_id, version, title, content)
      VALUES ('${siteId}', '${pageId}', ${version}, 'Т', '{"blocks":[]}')`
    await expect(client.exec(insert(1))).rejects.toThrow(/page_revisions_page_version_unique/)
    await expect(client.exec(insert(0))).rejects.toThrow(/page_revisions_version_positive/)

    // Автор версии — человек или токен, но не оба сразу
    const { rows: authors } = await client.query<{ user_id: string; token_id: string }>(`
      WITH u AS (INSERT INTO users (name, email) VALUES ('Автор', 'a@example.test') RETURNING id)
      INSERT INTO api_tokens (site_id, name, token_hash, created_by)
      SELECT '${siteId}', 'mcp', 'hash', id FROM u RETURNING created_by AS user_id, id AS token_id
    `)
    const author = authors[0]
    await expect(
      client.exec(`
        INSERT INTO page_revisions (site_id, page_id, version, title, content, published_by, published_by_token)
        VALUES ('${siteId}', '${pageId}', 2, 'Т', '{"blocks":[]}', '${author?.user_id}', '${author?.token_id}')`),
    ).rejects.toThrow(/page_revisions_one_author/)

    // Удаление страницы уносит её историю
    await client.exec(`DELETE FROM pages WHERE id = '${pageId}'`)
    const { rows: left } = await client.query('SELECT id FROM page_revisions')
    expect(left).toEqual([])
  })

  it('опубликованной странице без даты публикации ставит время её последней правки', async () => {
    client = new PGlite()
    for (const name of [
      '0000_init',
      '0001_page_published_title',
      '0002_page_published_with_title',
      '0003_auth',
    ]) {
      await applyMigration(client, name)
    }
    await client.exec(`
      INSERT INTO sites (id, name, theme) VALUES ('${siteId}', 'Сайт', '{}');
      INSERT INTO pages (site_id, slug, title, draft, published, published_title, published_at, updated_at) VALUES
        ('${siteId}', 'index', 'Т', '{"blocks":[]}', '{"blocks":[]}', 'Т', NULL, '2026-09-01T08:00:00Z');
    `)

    await applyMigration(client, '0004_page_revisions')

    const { rows } = await client.query<{ published_at: Date }>(
      'SELECT published_at FROM page_revisions',
    )
    expect(rows.map((row) => row.published_at.toISOString())).toEqual(['2026-09-01T08:00:00.000Z'])
  })
})

describe('миграция 0005_media', () => {
  const siteId = '00000000-0000-4000-8000-000000000001'

  it('ложится на базу с контентом и держит тип и размеры проверками', async () => {
    client = new PGlite()
    for (const name of [
      '0000_init',
      '0001_page_published_title',
      '0002_page_published_with_title',
      '0003_auth',
      '0004_page_revisions',
    ]) {
      await applyMigration(client, name)
    }
    await client.exec(`
      INSERT INTO sites (id, name, theme) VALUES ('${siteId}', 'Сайт', '{}');
      INSERT INTO pages (site_id, slug, title, draft) VALUES ('${siteId}', 'index', 'Главная', '{"blocks":[]}');
    `)

    await applyMigration(client, '0005_media')

    const insert = (values: { mime?: string; width?: number }) => `
      INSERT INTO media (site_id, original_name, mime_type, width, height, size, variants, original_file)
      VALUES ('${siteId}', 'a.jpg', '${values.mime ?? 'image/jpeg'}', ${values.width ?? 100}, 50, 1000, '[]', 'original.jpg')`
    await client.exec(insert({}))
    await expect(client.exec(insert({ mime: 'image/svg+xml' }))).rejects.toThrow(
      /media_mime_type_valid/,
    )
    await expect(client.exec(insert({ width: 0 }))).rejects.toThrow(/media_size_positive/)

    // Автор — человек или токен, но не оба сразу
    const { rows: users } = await client.query<{ id: string }>(
      `INSERT INTO users (name, email) VALUES ('Автор', 'author@example.test') RETURNING id`,
    )
    const { rows: tokens } = await client.query<{ id: string }>(
      `INSERT INTO api_tokens (site_id, name, token_hash) VALUES ('${siteId}', 'mcp', 'hash') RETURNING id`,
    )
    await expect(
      client.exec(`
        INSERT INTO media (site_id, original_name, mime_type, width, height, size, variants, original_file, uploaded_by, uploaded_by_token)
        VALUES ('${siteId}', 'b.jpg', 'image/jpeg', 10, 10, 10, '[]', 'original.jpg', '${users[0]?.id}', '${tokens[0]?.id}')`),
    ).rejects.toThrow(/media_one_author/)

    // Удаление сайта уносит его медиатеку
    await client.exec(`DELETE FROM sites WHERE id = '${siteId}'`)
    const { rows } = await client.query('SELECT id FROM media')
    expect(rows).toEqual([])
  })
})

describe('миграция 0006_mail_outbox', () => {
  it('держит статус, попытки и время отправки; письма сайта уходят вместе с ним', async () => {
    client = new PGlite()
    for (const name of [
      '0000_init',
      '0001_page_published_title',
      '0002_page_published_with_title',
      '0003_auth',
      '0004_page_revisions',
      '0005_media',
      '0006_mail_outbox',
    ]) {
      await applyMigration(client, name)
    }
    const siteId = '00000000-0000-4000-8000-000000000001'
    await client.exec(`INSERT INTO sites (id, name, theme) VALUES ('${siteId}', 'Сайт', '{}')`)

    const insert = (values: string) => `
      INSERT INTO mail_outbox (site_id, template, data, recipient, status, attempts, sent_at)
      VALUES (${values})`
    await client.exec(insert(`'${siteId}', 'mail-test', '{}', 'a@b.ru', 'pending', 0, NULL`))
    await client.exec(insert(`NULL, 'mail-test', '{}', 'a@b.ru', 'sent', 1, now()`))
    await expect(
      client.exec(insert(`NULL, 'mail-test', '{}', 'a@b.ru', 'queued', 0, NULL`)),
    ).rejects.toThrow(/mail_outbox_status_valid/)
    await expect(
      client.exec(insert(`NULL, 'mail-test', '{}', 'a@b.ru', 'pending', -1, NULL`)),
    ).rejects.toThrow(/mail_outbox_attempts_valid/)
    // Отправленное знает, когда ушло, а ждущее не притворяется отправленным
    await expect(
      client.exec(insert(`NULL, 'mail-test', '{}', 'a@b.ru', 'sent', 1, NULL`)),
    ).rejects.toThrow(/mail_outbox_sent_at_valid/)
    await expect(
      client.exec(insert(`NULL, 'mail-test', '{}', 'a@b.ru', 'pending', 0, now()`)),
    ).rejects.toThrow(/mail_outbox_sent_at_valid/)

    await client.exec(`DELETE FROM sites WHERE id = '${siteId}'`)
    const { rows } = await client.query<{ site_id: string | null }>(
      'SELECT site_id FROM mail_outbox',
    )
    expect(rows).toEqual([{ site_id: null }])
  })
})

describe('миграция 0007_mail_outbox_data_lifetime', () => {
  it('стирает данные отправленных писем и писем со ссылкой и держит это проверкой', async () => {
    client = new PGlite()
    for (const name of [
      '0000_init',
      '0001_page_published_title',
      '0002_page_published_with_title',
      '0003_auth',
      '0004_page_revisions',
      '0005_media',
      '0006_mail_outbox',
    ]) {
      await applyMigration(client, name)
    }
    const insert = (template: string, status: string, sentAt = 'NULL') => `
      INSERT INTO mail_outbox (template, data, recipient, status, sent_at)
      VALUES ('${template}', '{"url":"https://admin.example.ru/reset?token=SECRET"}', 'a@b.ru', '${status}', ${sentAt})`
    await client.exec(insert('mail-test', 'pending'))
    await client.exec(insert('mail-test', 'sent', 'now()'))
    await client.exec(insert('mail-test', 'failed'))
    await client.exec(insert('password-reset', 'failed'))

    await applyMigration(client, '0007_mail_outbox_data_lifetime')

    const { rows } = await client.query<{ template: string; status: string; has_data: boolean }>(
      'SELECT template, status, data IS NOT NULL AS has_data FROM mail_outbox ORDER BY template, status',
    )
    expect(rows).toEqual([
      // Неотправленное письмо без секрета хранит данные: его можно повторить
      { template: 'mail-test', status: 'failed', has_data: true },
      { template: 'mail-test', status: 'pending', has_data: true },
      { template: 'mail-test', status: 'sent', has_data: false },
      { template: 'password-reset', status: 'failed', has_data: false },
    ])
    // Отправленное письмо с данными и ждущее без данных база не примет
    await expect(client.exec(insert('mail-test', 'sent', 'now()'))).rejects.toThrow(
      /mail_outbox_data_lifetime/,
    )
    await expect(
      client.exec(
        `INSERT INTO mail_outbox (template, data, recipient, status) VALUES ('mail-test', NULL, 'a@b.ru', 'pending')`,
      ),
    ).rejects.toThrow(/mail_outbox_data_lifetime/)
  })
})
