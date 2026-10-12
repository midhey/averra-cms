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
