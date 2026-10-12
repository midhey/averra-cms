import type { PageContent, Theme } from '@cms/schema'
import { sql } from 'drizzle-orm'
import { check, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

// В коде поля в camelCase, в базе колонки в snake_case: casing задан в drizzle.config.ts и client.ts

export const sites = pgTable('sites', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  theme: jsonb().$type<Theme>().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const pages = pgTable(
  'pages',
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    slug: text().notNull(),
    title: text().notNull(),
    // Черновик правят в админке, а на сайт попадает только опубликованная копия
    draft: jsonb().$type<PageContent>().notNull(),
    published: jsonb().$type<PageContent>(),
    // Заголовок тоже версионируется: правка во вкладке не должна попасть на сайт до публикации
    publishedTitle: text(),
    publishedAt: timestamp({ withTimezone: true }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pages_site_slug_unique').on(table.siteId, table.slug),
    // Опубликованная версия — это содержимое и заголовок вместе: без заголовка снимок
    // сайта не может отдать страницу, поэтому половинчатую публикацию не пускает база
    check(
      'pages_published_with_title',
      sql`(${table.published} IS NULL) = (${table.publishedTitle} IS NULL)`,
    ),
  ],
)
