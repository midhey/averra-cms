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

    // Удаление страницы уносит её историю
    await client.exec(`DELETE FROM pages WHERE id = '${pageId}'`)
    const { rows: left } = await client.query('SELECT id FROM page_revisions')
    expect(left).toEqual([])
  })
})
