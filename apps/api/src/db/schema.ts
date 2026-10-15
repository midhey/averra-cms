import type { ImageFormat, ImageMimeType, PageContent, Theme } from '@averra/schema'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
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
 * Приглашения участников на сайт. Ссылка из письма несёт токен, а здесь только его SHA-256:
 * строка находится по id из токена, хеш сверяется за постоянное время (как у api_tokens).
 * Приглашение одноразовое: принятое, отозванное или истёкшее больше не работает
 */
export const userInvitations = pgTable(
  'user_invitations',
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    // Кого пригласили: почта в нижнем регистре, как в users
    email: text().notNull(),
    role: text({ enum: ['editor', 'client'] }).notNull(),
    tokenHash: text().notNull(),
    // Кто пригласил. Удалили пользователя — приглашение остаётся, просто без автора
    invitedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    // Кто принял: новый пользователь или тот, кто уже был
    acceptedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('user_invitations_site_id_idx').on(table.siteId),
    // У адреса на сайте одно открытое приглашение: новое отзывает прежнее (invitations/service.ts)
    uniqueIndex('user_invitations_open_unique')
      .on(table.siteId, table.email)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    check('user_invitations_role_valid', sql`${table.role} IN ('editor', 'client')`),
    check('user_invitations_email_lower', sql`${table.email} = lower(${table.email})`),
    check('user_invitations_expires_valid', sql`${table.expiresAt} > ${table.createdAt}`),
    // Принятое не отзывают, отозванное не принимают
    check(
      'user_invitations_one_outcome',
      sql`${table.acceptedAt} IS NULL OR ${table.revokedAt} IS NULL`,
    ),
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

/**
 * Снимок страницы при каждой публикации: что ушло на сайт, кто и когда. Пишет его публикация
 * в той же транзакции (sitesRepo.publish), а возврат версии в черновик историю не меняет
 */
export const pageRevisions = pgTable(
  'page_revisions',
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    // История живёт, пока жива страница: новая страница с тем же адресом начинает с версии 1
    pageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    // Номер публикации у страницы. Время двух быстрых публикаций может совпасть, номер — нет
    version: integer().notNull(),
    title: text().notNull(),
    content: jsonb().$type<PageContent>().notNull(),
    // Автор — ссылкой, имя берётся при чтении. Пусто у публикаций до истории и у демо-сайта
    publishedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    publishedByToken: uuid().references(() => apiTokens.id, { onDelete: 'set null' }),
    publishedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('page_revisions_page_version_unique').on(table.pageId, table.version),
    index('page_revisions_site_id_idx').on(table.siteId),
    check(
      'page_revisions_one_author',
      sql`${table.publishedBy} IS NULL OR ${table.publishedByToken} IS NULL`,
    ),
    check('page_revisions_version_positive', sql`${table.version} > 0`),
  ],
)

/** Вариант картинки: какой файл лежит в хранилище и что в нём. Имя файла строит сервер */
export type StoredVariant = {
  format: ImageFormat
  width: number
  height: number
  /** Вес файла в байтах */
  size: number
  /** Имя файла в папке картинки: 480.avif. Из него и id строится ключ в хранилище */
  file: string
}

/**
 * Медиатека сайта. Файлы лежат в хранилище (src/media/storage.ts) по ключу из site_id, id
 * и имени варианта — пользовательский ввод в путь не попадает. Имя загруженного файла
 * хранится только для показа в админке
 */
export const media = pgTable(
  'media',
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    originalName: text().notNull(),
    // Тип по содержимому файла, а не по расширению: его определил sharp
    mimeType: text().$type<ImageMimeType>().notNull(),
    // Размеры уже после поворота по EXIF — такими картинку видит человек
    width: integer().notNull(),
    height: integer().notNull(),
    // Вес загруженного файла в байтах
    size: integer().notNull(),
    variants: jsonb().$type<StoredVariant[]>().notNull(),
    // Чистый оригинал в полном размере: из него потом можно нарезать новые варианты
    originalFile: text().notNull(),
    uploadedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    uploadedByToken: uuid().references(() => apiTokens.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('media_site_id_idx').on(table.siteId),
    check(
      'media_mime_type_valid',
      sql`${table.mimeType} IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')`,
    ),
    check(
      'media_size_positive',
      sql`${table.width} > 0 AND ${table.height} > 0 AND ${table.size} > 0`,
    ),
    check('media_one_author', sql`${table.uploadedBy} IS NULL OR ${table.uploadedByToken} IS NULL`),
  ],
)

/** Состояние письма в очереди: ждёт, отправляется, отправлено, окончательно не отправлено */
export const mailStatuses = ['pending', 'sending', 'sent', 'failed'] as const
export type MailStatusValue = (typeof mailStatuses)[number]

/**
 * Очередь писем (паттерн outbox). Письмо пишется сюда в той же транзакции, что и действие
 * (enqueueMail в src/mail/outbox.ts), а отправляет его обработчик с повторами. Данные письма
 * (data) живут только до отправки: у отправленного их нет, а у письма с одноразовой ссылкой
 * их нет и после неудачи. Сами строки удаляются через MAIL_RETENTION_DAYS
 */
export const mailOutbox = pgTable(
  'mail_outbox',
  {
    id: uuid().primaryKey().defaultRandom(),
    // Письма о заявках относятся к сайту, письма системы (сброс пароля) — нет
    siteId: uuid().references(() => sites.id, { onDelete: 'cascade' }),
    // Id шаблона из src/mail/templates. Данные проверены его схемой при постановке в очередь
    template: text().notNull(),
    // Данные шаблона. null — стёрты: письмо отправлено или в нём была одноразовая ссылка
    data: jsonb().$type<unknown>(),
    recipient: text().notNull(),
    status: text().$type<MailStatusValue>().notNull().default('pending'),
    // Сколько раз письмо брали в отправку
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Аренда обработчика: пока она не истекла, письмо в статусе sending никто другой не берёт
    lockedUntil: timestamp({ withTimezone: true }),
    // Кто взял письмо: итог отправки записывается только с тем же claim_id
    claimId: uuid(),
    // Текст последней ошибки, без секретов
    lastError: text(),
    lastAttemptAt: timestamp({ withTimezone: true }),
    // Message-ID, который вернул провайдер
    messageId: text(),
    sentAt: timestamp({ withTimezone: true }),
    // Срок одноразовой ссылки в письме: позже письмо бессмысленно и не отправляется
    expiresAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mail_outbox_due_idx').on(table.status, table.nextAttemptAt),
    index('mail_outbox_sent_at_idx').on(table.sentAt),
    index('mail_outbox_site_id_idx').on(table.siteId),
    check(
      'mail_outbox_status_valid',
      sql`${table.status} IN ('pending', 'sending', 'sent', 'failed')`,
    ),
    check('mail_outbox_attempts_valid', sql`${table.attempts} >= 0`),
    // Отправленное письмо всегда знает, когда ушло, а неотправленное — не притворяется ушедшим
    check(
      'mail_outbox_sent_at_valid',
      sql`(${table.status} = 'sent') = (${table.sentAt} IS NOT NULL)`,
    ),
    // Ждущему и отправляющемуся письму данные нужны, у отправленного их уже нет: секреты
    // и персональные данные лежат в базе не дольше, чем нужно для отправки
    check(
      'mail_outbox_data_lifetime',
      sql`(${table.status} IN ('pending', 'sending') AND ${table.data} IS NOT NULL) OR (${table.status} = 'sent' AND ${table.data} IS NULL) OR ${table.status} = 'failed'`,
    ),
  ],
)
