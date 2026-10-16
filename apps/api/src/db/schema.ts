import type {
  FormFieldType,
  ImageFormat,
  ImageMimeType,
  LeadStatus,
  PageContent,
  SiteBuildStatus,
  Theme,
} from '@averra/schema'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// В коде поля в camelCase, в базе колонки в snake_case: casing задан в drizzle.config.ts и client.ts

export const sites = pgTable(
  'sites',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    theme: jsonb().$type<Theme>().notNull(),
    // Заявки с форм сайта (модуль 8). Кому слать уведомления: пусто — всем владельцам админки.
    // Адреса проверены LeadSettings при сохранении
    leadRecipients: jsonb().$type<string[]>().notNull().default([]),
    // Сколько дней хранить заявки: в них персональные данные (152-ФЗ)
    leadRetentionDays: integer().notNull().default(180),
    // Слать ли посетителю подтверждение, что заявка получена (фиксированный текст)
    leadConfirmation: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('sites_lead_retention_valid', sql`${table.leadRetentionDays} BETWEEN 7 AND 1825`),
    check('sites_lead_recipients_array', sql`jsonb_typeof(${table.leadRecipients}) = 'array'`),
  ],
)

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

/** Значение поля в заявке так, как его видела форма: ключ, подпись, тип и что ввёл посетитель */
export type StoredLeadField = {
  name: string
  label: string
  type: FormFieldType
  value: string | boolean
}

/**
 * Заявки с форм сайта (модуль 8). Пишет их открытый приём (modules/leads) в той же транзакции,
 * что и письма о них. Подписи полей хранятся вместе со значениями: форму потом переименуют,
 * а заявка должна читаться так, как её видел посетитель. IP посетителя не храним (152-ФЗ):
 * для лимитов он живёт только в памяти процесса. Удаляются через lead_retention_days сайта
 */
export const leads = pgTable(
  'leads',
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    // Страницу удалили — заявка остаётся, адрес страницы и id блока — в своих колонках
    pageId: uuid().references(() => pages.id, { onDelete: 'set null' }),
    pageSlug: text().notNull(),
    blockId: text().notNull(),
    formTitle: text().notNull(),
    data: jsonb().$type<StoredLeadField[]>().notNull(),
    // Размер data в байтах (UTF-8 JSON) — для дневного предела объёма: сумма по колонке, а не
    // распаковка jsonb всех заявок сайта за сутки на каждой отправке формы
    dataBytes: integer().notNull().default(0),
    // Согласие на обработку персональных данных: какой текст и какая политика были на странице,
    // какая версия страницы была опубликована и когда посетитель согласился
    consentText: text().notNull(),
    consentPolicyUrl: text().notNull(),
    pageVersion: integer(),
    consentedAt: timestamp({ withTimezone: true }).notNull(),
    status: text().$type<LeadStatus>().notNull().default('new'),
    processedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('leads_site_created_idx').on(table.siteId, table.createdAt),
    index('leads_created_at_idx').on(table.createdAt),
    check('leads_status_valid', sql`${table.status} IN ('new', 'processed')`),
    // Обработанная знает, когда её обработали, а новая не притворяется обработанной
    check(
      'leads_processed_at_valid',
      sql`(${table.status} = 'processed') = (${table.processedAt} IS NOT NULL)`,
    ),
    check('leads_data_array', sql`jsonb_typeof(${table.data}) = 'array'`),
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
    // Заявка, о которой письмо. Удалили заявку (руками или по сроку хранения) — уходят и письма
    // о ней: в неотправленных лежит копия её полей, в подтверждении — почта посетителя (152-ФЗ)
    leadId: uuid().references(() => leads.id, { onDelete: 'cascade' }),
    // Id шаблона из src/mail/templates. Данные проверены его схемой при постановке в очередь
    template: text().notNull(),
    // Данные шаблона. null — стёрты: письмо отправлено или в нём была одноразовая ссылка
    data: jsonb().$type<unknown>(),
    recipient: text().notNull(),
    // Ящик, куда ведёт адрес (mailboxKey: нижний регистр, без метки «+», gmail без точек) —
    // по нему лимит «подтверждение не чаще раза в сутки на адрес» не обходится vasya+1@…
    recipientKey: text(),
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
    index('mail_outbox_lead_id_idx').on(table.leadId),
    index('mail_outbox_recipient_key_idx').on(table.siteId, table.recipientKey, table.createdAt),
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

/**
 * Настройки SMTP, которые владелец задаёт в админке (страница «Почта»). Строка с site_id = NULL —
 * на всю установку, она одна (уникальность с NULLS NOT DISTINCT). Потом сюда лягут строки сайтов:
 * свой SMTP у сайта для писем о заявках. SMTP из окружения (SMTP_HOST…) главнее этой таблицы.
 * Пароль — только зашифрованным (src/crypto), и наружу он не отдаётся никогда (src/mail/settings.ts)
 */
export const mailSettings = pgTable(
  'mail_settings',
  {
    id: uuid().primaryKey().defaultRandom(),
    // Чьи настройки: NULL — вся установка. Пока код читает и пишет только эту строку
    siteId: uuid().references(() => sites.id, { onDelete: 'cascade' }),
    host: text().notNull(),
    port: integer().notNull(),
    security: text({ enum: ['tls', 'starttls'] }).notNull(),
    username: text().notNull(),
    // AES-256-GCM: v1.<версия ключа>.<iv>.<тег>.<шифротекст>. Формат держит CHECK ниже
    passwordEncrypted: text().notNull(),
    fromAddress: text().notNull(),
    fromName: text().notNull(),
    // Когда для этих настроек прошла проверка подключения. NULL — сохранены без проверки
    verifiedAt: timestamp({ withTimezone: true }),
    // Кто поменял последним. Удалили пользователя — настройки остаются
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Одна строка на установку (site_id NULL) и, потом, не больше одной на сайт
    unique('mail_settings_site_unique').on(table.siteId).nullsNotDistinct(),
    // Только TLS сразу на 465 или обязательный STARTTLS на 587: других режимов нет
    check(
      'mail_settings_mode_valid',
      sql`(${table.port} = 465 AND ${table.security} = 'tls') OR (${table.port} = 587 AND ${table.security} = 'starttls')`,
    ),
    // Пароль только зашифрованным: открытый пароль база не примет даже по ошибке в коде.
    // [.] — точка как символ: обратный слеш в шаблонной строке JS потерялся бы
    check(
      'mail_settings_password_sealed',
      sql`${table.passwordEncrypted} ~ '^v1[.][0-9a-f]{16}[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]+$'`,
    ),
  ],
)

/**
 * Журнал сборок сайта на сервере (модуль 9): после публикации API собирает статику в новую папку
 * релиза и подменяет ею текущую (src/publish). Строка — одна сборка: ждёт, идёт, готова или упала.
 * У сайта одновременно не больше одной ждущей сборки: повторная публикация, пока сборка ждёт,
 * новой не заводит (её подхватит та же). Хранятся последние сборки сайта (buildsRepo.finish)
 */
export const siteBuilds = pgTable(
  'site_builds',
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    status: text().$type<SiteBuildStatus>().notNull().default('queued'),
    // Имя папки релиза, которую сборка сделала текущей. Только у готовой
    release: text(),
    // Почему упала: хвост вывода сборщика, без секретов (сборщику они не передаются)
    error: text(),
    // Пиковая память процесса сборки в байтах: хватает ли VPS (цель — 1–2 ГБ)
    peakRssBytes: bigint({ mode: 'number' }),
    requestedAt: timestamp({ withTimezone: true }).notNull(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('site_builds_site_requested_idx').on(table.siteId, table.requestedAt),
    check(
      'site_builds_status_valid',
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed')`,
    ),
    // Готовая знает свой релиз, упавшая — причину, и обе — когда закончили
    check(
      'site_builds_result_valid',
      sql`(${table.status} = 'succeeded') = (${table.release} IS NOT NULL)
        AND (${table.status} = 'failed') = (${table.error} IS NOT NULL)
        AND (${table.status} IN ('succeeded', 'failed')) = (${table.finishedAt} IS NOT NULL)`,
    ),
    // Одна ждущая сборка на сайт: повторный запрос ждущую не плодит (и при гонке тоже)
    uniqueIndex('site_builds_one_queued').on(table.siteId).where(sql`${table.status} = 'queued'`),
  ],
)
