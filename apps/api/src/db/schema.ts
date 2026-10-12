import type { PageContent, Theme } from '@cms/schema'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

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

// Пользователи админки. Таблицы users, sessions, accounts и verifications ведёт Better Auth:
// набор полей — его (см. auth/auth.ts), имена во множественном числе — наши (usePlural)

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    email: text().notNull().unique(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    // owner — вся админка; member — только сайты, куда его добавили (site_members)
    role: text({ enum: ['owner', 'member'] })
      .notNull()
      .default('member'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('users_role_valid', sql`${table.role} IN ('owner', 'member')`)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ipAddress: text(),
    userAgent: text(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
)

export const accounts = pgTable(
  'accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    // Хеш пароля (у provider_id = 'credential'); сам пароль нигде не хранится
    password: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('accounts_user_id_idx').on(table.userId)],
)

export const verifications = pgTable(
  'verifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
)

/** Доступ участника (users.role = member) к сайту. Владельцу записи не нужны: ему открыто всё */
export const siteMembers = pgTable(
  'site_members',
  {
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // editor — правит и публикует; client — только правит черновики
    role: text({ enum: ['editor', 'client'] }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.userId] }),
    index('site_members_user_id_idx').on(table.userId),
    check('site_members_role_valid', sql`${table.role} IN ('editor', 'client')`),
  ],
)

/**
 * Токены API для MCP и других программ: права редактора на одном сайте.
 * Хранится только SHA-256 токена — сам токен показывается один раз при создании
 */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    tokenHash: text().notNull(),
    // Кто выпустил. Удалили пользователя — токен остаётся, просто без автора
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (table) => [index('api_tokens_site_id_idx').on(table.siteId)],
)
