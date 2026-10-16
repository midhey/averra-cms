import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { MailAddress, MailSenderName } from '@averra/schema'
import { z } from 'zod'
import { isLoopbackHost } from './loopback'
import { MAIL_OFF_EFFECT } from './mail/mailer'

/**
 * Секрет подписи cookie для разработки и тестов. Он лежит в репозитории, поэтому годится
 * только для учебного режима (см. isLocalDev ниже). Значение нарочно говорящее
 */
export const DEV_AUTH_SECRET = 'dev-only-secret-not-for-production-0123456789'

/** Узнаваемые части учебного секрета после нормализации: только буквы и цифры, нижний регистр */
const DEV_SECRET_MARKERS = ['devonlysecret', 'notforproduction']

/**
 * Учебный секрет или его вариант: с пробелами по краям, в кавычках, в другом регистре, с другими
 * разделителями (_ вместо -), полноширинными символами или только его часть. Все они — тот же
 * публичный секрет из репозитория, поэтому сравнение точным совпадением не годится: вариант прошёл
 * бы как «свой» секрет и снял бы защиту loopback. Ловим то, что получается по небрежности при
 * копировании; нарочно искажённый секрет (похожие буквы другого алфавита, кодировки) — уже другой
 * ключ, и его не распознаём
 */
export function isDevAuthSecret(secret: string) {
  // NFKC сводит полноширинные и другие совместимые формы символов к обычным латинским
  const normalized = secret
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return DEV_SECRET_MARKERS.some((marker) => normalized.includes(marker))
}

/**
 * Ключ шифрования пароля SMTP для разработки и e2e: base64 строки «dev-only-mail-key-not-for-prod!!».
 * Он лежит в репозитории, поэтому, как и DEV_AUTH_SECRET, годится только для учебного режима:
 * пароль, зашифрованный им, защищён только для вида
 */
export const DEV_MAIL_ENCRYPTION_KEY = 'ZGV2LW9ubHktbWFpbC1rZXktbm90LWZvci1wcm9kISE='

/** Узнаваемые части учебного ключа: в нём самом (как тексте) и в его записи base64 */
const DEV_MAIL_KEY_MARKERS = ['devonlymailkey', 'notforprod']

const lettersAndDigits = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** Сколько байт в ключе AES-256 */
const MAIL_KEY_BYTES = 32

/**
 * Байты ключа из base64 или base64url, с «=» в конце или без. Пробелы и кавычки по краям
 * не мешают: так ключ часто приходит из .env. Не base64 — undefined
 */
function decodeMailKey(value: string) {
  const compact = value.trim().replace(/^(["'])(.*)\1$/, '$2')
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return undefined
  return Buffer.from(compact.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
}

/**
 * Учебный ключ шифрования или его вариант: с пробелами и кавычками, в другом регистре, в записи
 * base64url или без «=», его часть, а ещё тот же учебный текст, записанный в base64 иначе. Все они —
 * публичный ключ из репозитория (ловим небрежность при копировании, как isDevAuthSecret)
 */
export function isDevMailKey(value: string) {
  const normalized = lettersAndDigits(value)
  const dev = lettersAndDigits(DEV_MAIL_ENCRYPTION_KEY)
  if (normalized.length >= 16 && (dev.includes(normalized) || normalized.includes(dev))) return true
  if (DEV_MAIL_KEY_MARKERS.some((marker) => normalized.includes(marker))) return true
  const decoded = decodeMailKey(value)
  if (decoded === undefined) return false
  const text = lettersAndDigits(decoded.toString('latin1'))
  return DEV_MAIL_KEY_MARKERS.some((marker) => text.includes(marker))
}

const MAIL_KEY_HINT =
  '32 случайных байта в base64 (44 символа). Сгенерировать: openssl rand -base64 32 ' +
  `или node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`

/**
 * Адрес без пути: с ним сравнивается заголовок Origin, а в нём пути не бывает.
 * Zod 4 гоняет проверки и после проваленной z.url, поэтому сначала URL.canParse: иначе на
 * пустой строке (так часто «снимают» переменную в compose) падал бы new URL, а не конфиг
 */
const Origin = z
  .url({ protocol: /^https?$/ })
  .refine((url) => !URL.canParse(url) || new URL(url).origin === url, {
    error: 'Нужен адрес без пути и косой черты в конце, например https://admin.example.ru',
  })

const isLoopbackUrl = (url: string) => URL.canParse(url) && isLoopbackHost(new URL(url).hostname)

type RawEnv = { NODE_ENV: string; PORT: number; ADMIN_URL?: string; API_URL?: string }

export type ConfigOptions = {
  /**
   * Учебный режим попросили явно: флаг --dev у API ставят только pnpm dev и e2e.
   * Без него API требует свой AUTH_SECRET, как бы ни были заданы остальные переменные
   */
  dev?: boolean
}

const urlsOf = (env: RawEnv) => ({
  ADMIN_URL: env.ADMIN_URL ?? 'http://localhost:5173',
  API_URL: env.API_URL ?? `http://localhost:${env.PORT}`,
})

/**
 * Учебный режим: явный флаг --dev, не прод и оба адреса на этом компьютере. Только в нём можно
 * жить без своего AUTH_SECRET и заводить демо-сайт и владельца для разработки.
 *
 * Главное — флаг. Раньше учебным был запуск вовсе без переменных, и такой API на сервере
 * за прокси (nginx по умолчанию шлёт апстриму Host 127.0.0.1:4000) отвечал всем на публичном
 * секрете. Забыть переменные легко, а дописать --dev к команде запуска случайно — нет.
 * Адреса — второй замок: на сервере их задают всегда (иначе админка не войдёт)
 */
function isLocalDev(env: RawEnv, { dev = false }: ConfigOptions) {
  const { ADMIN_URL, API_URL } = urlsOf(env)
  return dev && env.NODE_ENV !== 'production' && isLoopbackUrl(ADMIN_URL) && isLoopbackUrl(API_URL)
}

type MailEnv = RawEnv & {
  MAIL_TRANSPORT?: 'smtp' | 'file' | 'off'
  SMTP_HOST?: string
  SMTP_PORT: number
  SMTP_SECURITY?: 'tls' | 'starttls'
  SMTP_USER?: string
  SMTP_PASSWORD?: string
  MAIL_FROM?: string
  MAIL_FROM_NAME: string
  MAIL_DIR: string
  MAIL_MAX_ATTEMPTS: number
  MAIL_RETENTION_DAYS: number
}

/** Какой провайдер почты выбран: явно в MAIL_TRANSPORT или по тому, что задано */
function mailTransportOf(env: MailEnv, options: ConfigOptions) {
  if (env.MAIL_TRANSPORT) return env.MAIL_TRANSPORT
  if (env.SMTP_HOST !== undefined) return 'smtp'
  // Файловый ящик по умолчанию только в учебном режиме: на сервере письма молча ложились бы в папку
  return isLocalDev(env, options) ? 'file' : 'off'
}

/** Режим шифрования по порту: 465 — TLS сразу, 587 и 25 — STARTTLS. Для других портов — явно */
const securityByPort: Record<number, 'tls' | 'starttls'> = {
  465: 'tls',
  587: 'starttls',
  25: 'starttls',
}

function checkMail(env: MailEnv, options: ConfigOptions, ctx: z.RefinementCtx) {
  const transport = mailTransportOf(env, options)
  if (transport === 'file' && env.NODE_ENV === 'production') {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_TRANSPORT'],
      message: 'Файловый ящик — только для разработки: в проде письма не дошли бы до людей',
    })
  }
  if (transport !== 'smtp') return
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'] as const) {
    if (env[key] === undefined) {
      ctx.addIssue({ code: 'custom', path: [key], message: `Для отправки через SMTP нужен ${key}` })
    }
  }
  if (env.SMTP_SECURITY === undefined && securityByPort[env.SMTP_PORT] === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['SMTP_SECURITY'],
      message: `Для порта ${env.SMTP_PORT} задай SMTP_SECURITY: tls (TLS сразу) или starttls`,
    })
  }
}

/**
 * Настройки почты для index.ts и команд. Пароль здесь, но наружу он идёт только в smtpMailer.
 * fromEnv — окружение решило само (SMTP_HOST или явный MAIL_TRANSPORT): тогда оно главнее
 * настроек SMTP из админки. Иначе transport — то, что берётся, когда в админке SMTP не задан
 */
function mailConfig(env: MailEnv, options: ConfigOptions) {
  const common = {
    maxAttempts: env.MAIL_MAX_ATTEMPTS,
    retentionDays: env.MAIL_RETENTION_DAYS,
    fromEnv: env.MAIL_TRANSPORT !== undefined || env.SMTP_HOST !== undefined,
  }
  const transport = mailTransportOf(env, options)
  const from = { address: env.MAIL_FROM ?? 'noreply@averra.test', name: env.MAIL_FROM_NAME }
  if (transport === 'file') return { ...common, transport, dir: env.MAIL_DIR, from }
  if (transport === 'smtp' && env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD) {
    return {
      ...common,
      transport,
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      security: env.SMTP_SECURITY ?? securityByPort[env.SMTP_PORT] ?? 'tls',
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from,
    }
  }
  return {
    ...common,
    transport: 'off' as const,
    reason:
      env.MAIL_TRANSPORT === 'off'
        ? `Почта выключена (MAIL_TRANSPORT=off). ${MAIL_OFF_EFFECT}`
        : 'Почта не настроена: задайте SMTP на странице «Почта» в админке или переменными ' +
          `SMTP_HOST, SMTP_USER, SMTP_PASSWORD и MAIL_FROM (см. README, «Почта»). ${MAIL_OFF_EFFECT}`,
  }
}

/**
 * Ключ шифрования пароля SMTP из админки: свой из MAIL_ENCRYPTION_KEY или, в учебном режиме,
 * учебный. Вне учебного режима без ключа — undefined: API работает, а SMTP в админке только
 * для чтения. Варианты учебного ключа вне учебного режима отсекает проверка конфига
 */
function mailKeyOf(value: string | undefined, localDev: boolean) {
  const dev = { key: decodeMailKey(DEV_MAIL_ENCRYPTION_KEY), kind: 'dev' as const }
  if (value === undefined) return localDev ? dev : { key: undefined, kind: undefined }
  if (isDevMailKey(value)) return dev
  return { key: decodeMailKey(value), kind: 'env' as const }
}

export type MailConfig = ReturnType<typeof mailConfig>

const envSchema = (options: ConfigOptions) =>
  z
    .object({
      // Без NODE_ENV — разработка. Если забыть NODE_ENV=production на сервере, учебный секрет
      // всё равно не пройдёт: без флага --dev учебного режима нет (см. isLocalDev)
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      PORT: z.coerce.number().int().positive().default(4000),
      // Настоящий PostgreSQL (сервер): postgres://пользователь:пароль@хост:порт/база. Задан —
      // API и команды работают с ним, PGLITE_DIR не нужен. Не задан — встроенный PGlite.
      // Сообщения Zod значение не печатают, так что пароль из адреса в ошибку конфига не попадёт
      DATABASE_URL: z
        .string()
        .trim()
        .regex(/^postgres(ql)?:\/\/\S+$/, {
          error: 'DATABASE_URL — адрес вида postgres://пользователь:пароль@хост:5432/база',
        })
        .optional(),
      // Папка встроенного Postgres (PGlite) для разработки, когда DATABASE_URL не задан
      PGLITE_DIR: z.string().min(1).default('.data/pglite'),
      // Публикация на сервере (модуль 9): папка, где лежат собранные сайты — <id сайта>/releases/…
      // и ссылка current на текущую версию, которую отдаёт Caddy. Не задана — публикация только
      // меняет базу, а сайт собирают отдельно (pnpm dev, рендерер руками)
      PUBLISH_DIR: z.string().min(1).optional(),
      // Сколько последних версий сайта хранить на диске (текущая не удаляется никогда)
      PUBLISH_KEEP_RELEASES: z.coerce.number().int().min(2).max(50).default(5),
      // Сколько секунд ждать сборку сайта, прежде чем остановить её и считать упавшей
      PUBLISH_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(3600).default(300),
      // Предел кучи JavaScript процесса сборки, МБ (--max-old-space-size): сборка не съест память VPS.
      // Замер демо-сайта — около 360 МБ RSS всего процесса (docs/steps/3.6-vps-install.md)
      PUBLISH_MAX_MEMORY_MB: z.coerce.number().int().min(128).max(8192).default(768),
      // Папка пакета рендерера (apps/renderer). По умолчанию — рядом с API в репозитории или образе
      RENDERER_DIR: z.string().min(1).optional(),
      // Папка с картинками медиатеки. В проде её место займёт S3-совместимое хранилище
      MEDIA_DIR: z.string().min(1).default('.data/media'),
      // Самый большой файл, который принимает медиатека, в байтах. По умолчанию 10 МБ
      MEDIA_MAX_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .default(10 * 1024 * 1024),
      // Подпись cookie сессии. Сгенерировать: openssl rand -base64 32
      AUTH_SECRET: z.string().min(32).optional(),
      // Адрес админки: только с него Better Auth и API принимают запросы с cookie
      ADMIN_URL: Origin.optional(),
      // Адрес самого API снаружи (baseURL для Better Auth)
      API_URL: Origin.optional(),
      // true — API стоит за прокси (Caddy), который сам ставит X-Forwarded-For. Иначе заголовок
      // перезаписывается адресом соединения: подставив его, нельзя обойти лимит попыток входа
      TRUST_PROXY: z.stringbool().default(false),
      // Владелец, которого API создаёт в пустой базе в учебном режиме. Без --dev не используется
      DEV_OWNER_EMAIL: z.email().optional(),
      DEV_OWNER_PASSWORD: z.string().min(10).max(128).optional(),
      // Почта (см. README, «Почта»). smtp — настоящая отправка, file — письма в папку
      // (разработка), off — выключена. Не задано: SMTP_HOST → smtp, учебный режим → file, иначе off
      MAIL_TRANSPORT: z.enum(['smtp', 'file', 'off']).optional(),
      SMTP_HOST: z.string().trim().min(1).optional(),
      SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
      // tls — TLS сразу (порт 465), starttls — обязательный STARTTLS (587). Без шифрования нельзя
      SMTP_SECURITY: z.enum(['tls', 'starttls']).optional(),
      SMTP_USER: z.string().min(1).optional(),
      // Пароль только здесь, в окружении: не в базе, не в логах и не в ответах API.
      // Сообщения Zod значение не печатают, поэтому и ошибка конфига его не покажет
      SMTP_PASSWORD: z.string().min(1).optional(),
      // Адрес отправителя — всегда на своём домене с настроенными SPF, DKIM и DMARC
      MAIL_FROM: MailAddress.optional(),
      MAIL_FROM_NAME: MailSenderName.default('Averra CMS'),
      // Папка файлового ящика (MAIL_TRANSPORT=file)
      MAIL_DIR: z.string().min(1).default('.data/mail'),
      // Сколько раз пробовать отправить письмо, прежде чем сдаться
      MAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
      // Через сколько дней удалять отправленные и неотправленные письма: в них персональные данные
      MAIL_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
      // Ключ, которым шифруется пароль SMTP из админки (AES-256-GCM): 32 байта в base64.
      // Отдельный от AUTH_SECRET: утечка одного не даёт другого. Проверка — в superRefine,
      // чтобы сообщение не печатало значение
      MAIL_ENCRYPTION_KEY: z.string().optional(),
      // Только учебный режим (e2e): SMTP из админки подключается к этому порту того же сервера
      // вместо 465 или 587. Тестовый SMTP-сервер e2e слушает свободный порт: порты ниже 1024
      // на Linux без root не занять. Вне учебного режима — ошибка конфига
      DEV_SMTP_CONNECT_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    })
    .superRefine((env, ctx) => {
      if ((env.DEV_OWNER_EMAIL === undefined) !== (env.DEV_OWNER_PASSWORD === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: ['DEV_OWNER_PASSWORD'],
          message: 'DEV_OWNER_EMAIL и DEV_OWNER_PASSWORD задаются только вместе',
        })
      }
      if (env.NODE_ENV === 'production') {
        for (const key of ['AUTH_SECRET', 'ADMIN_URL', 'API_URL'] as const) {
          if (env[key] === undefined) {
            ctx.addIssue({ code: 'custom', path: [key], message: `В проде ${key} обязателен` })
          }
        }
      } else if (env.AUTH_SECRET === undefined && !isLocalDev(env, options)) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_SECRET'],
          message:
            'Нужен свой AUTH_SECRET (от 32 символов, например openssl rand -base64 32). ' +
            'Без него API запускается только для разработки: pnpm dev (флаг --dev), ' +
            'NODE_ENV не production и адреса ADMIN_URL и API_URL на localhost',
        })
      }
      checkMail(env, options, ctx)
      // Учебный ключ шифрования — по тем же правилам, что учебный секрет: только учебный режим
      if (env.MAIL_ENCRYPTION_KEY !== undefined) {
        if (isDevMailKey(env.MAIL_ENCRYPTION_KEY)) {
          if (!isLocalDev(env, options)) {
            ctx.addIssue({
              code: 'custom',
              path: ['MAIL_ENCRYPTION_KEY'],
              message:
                'Это учебный ключ шифрования из репозитория или его вариант: он годится только ' +
                `для разработки на localhost (pnpm dev). Задай свой — ${MAIL_KEY_HINT}`,
            })
          }
        } else if (decodeMailKey(env.MAIL_ENCRYPTION_KEY)?.length !== MAIL_KEY_BYTES) {
          ctx.addIssue({
            code: 'custom',
            path: ['MAIL_ENCRYPTION_KEY'],
            message: `MAIL_ENCRYPTION_KEY — ${MAIL_KEY_HINT}`,
          })
        }
      }
      // Порт для тестового SMTP — только учебный режим: в проде проверка подключения и отправка
      // через SMTP из админки ходят лишь на 465 и 587 (сервер не сканер портов)
      if (env.DEV_SMTP_CONNECT_PORT !== undefined && !isLocalDev(env, options)) {
        ctx.addIssue({
          code: 'custom',
          path: ['DEV_SMTP_CONNECT_PORT'],
          message:
            'DEV_SMTP_CONNECT_PORT — только для разработки и e2e (pnpm dev, флаг --dev, адреса ' +
            'на localhost). Уберите его: на сервере SMTP из админки ходит только на 465 и 587',
        })
      }
      // Учебный секрет, вписанный руками, — всё тот же публичный секрет из репозитория, в том числе
      // с пробелами, кавычками, в другом регистре или с другими разделителями (см. isDevAuthSecret)
      if (
        env.AUTH_SECRET !== undefined &&
        isDevAuthSecret(env.AUTH_SECRET) &&
        !isLocalDev(env, options)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_SECRET'],
          message:
            'Это учебный секрет из репозитория или его вариант (с пробелами, в кавычках, ' +
            'в другом регистре, его часть). Он годится только для разработки на localhost ' +
            '(pnpm dev). Задай свой: openssl rand -base64 32',
        })
      }
    })
    .transform((env) => {
      const AUTH_SECRET = env.AUTH_SECRET ?? DEV_AUTH_SECRET
      const { ADMIN_URL, API_URL } = urlsOf(env)
      // Демо-сайт и владелец для разработки — по тому же правилу, что и учебный секрет, а не
      // по одному NODE_ENV: иначе в пустую продовую базу лёг бы опубликованный демо-сайт
      const devSeed = env.NODE_ENV === 'development' && isLocalDev(env, options)
      const mailKey = mailKeyOf(env.MAIL_ENCRYPTION_KEY, isLocalDev(env, options))
      return {
        ...env,
        AUTH_SECRET,
        ADMIN_URL,
        API_URL,
        // Учебный секрет публичный, поэтому такой API отвечает только запросам к localhost
        // с этого компьютера. Это добавочная защита, а не главная: прокси на том же сервере,
        // который шлёт апстриму его Host (nginx по умолчанию), её обходит (см. client-ip.ts)
        loopbackOnly: isDevAuthSecret(AUTH_SECRET),
        // Заводить ли в пустой базе демо-сайт и владельца из DEV_OWNER_*
        devSeed,
        // Cookie только по HTTPS — в проде и везде, где API открыт по https.
        // Локально админка открыта по http, и Secure-cookie браузер бы не вернул
        secureCookies: env.NODE_ENV === 'production' || new URL(API_URL).protocol === 'https:',
        devOwner:
          devSeed && env.DEV_OWNER_EMAIL && env.DEV_OWNER_PASSWORD
            ? { email: env.DEV_OWNER_EMAIL, password: env.DEV_OWNER_PASSWORD }
            : undefined,
        mail: mailConfig(env, options),
        // Ключ шифрования пароля SMTP из админки. Нет — SMTP в админке только для чтения
        mailEncryptionKey: mailKey.key,
        // env — свой ключ, dev — учебный из репозитория (только pnpm dev): админка предупредит
        mailKeyKind: mailKey.kind,
        // Куда подключается SMTP из админки вместо 465 и 587 — только в учебном режиме (e2e)
        smtpConnectPort: isLocalDev(env, options) ? env.DEV_SMTP_CONNECT_PORT : undefined,
      }
    })

export type Config = z.output<ReturnType<typeof envSchema>>

/** Проверяет переменные окружения. Отдельно от loadConfig, чтобы проверять в тестах */
export function parseConfig(env: Record<string, string | undefined>, options: ConfigOptions = {}) {
  return envSchema(options).safeParse(env)
}

export type ApiArgs = { success: true; dev: boolean } | { success: false; error: string }

/**
 * Аргументы командной строки API: принимается только --dev (его ставят pnpm dev и e2e).
 * Опечатка или лишний аргумент — понятная ошибка, а не молчаливый пропуск: --Dev вместо --dev
 * иначе тихо запустил бы API без учебного режима. Отдельно от index.ts, чтобы проверять в тестах:
 * index.ts при импорте поднимает сервер. Без args — аргументы процесса
 */
export function parseApiArgs(args: string[] = process.argv.slice(2)): ApiArgs {
  // Нестрогий разбор с токенами, а не strict: parseArgs в strict бросает английскую ошибку,
  // а здесь нужен список всех непонятых аргументов в русском сообщении
  const { values, tokens } = parseArgs({
    args,
    options: { dev: { type: 'boolean' } },
    strict: false,
    allowPositionals: true,
    tokens: true,
  })
  // В сообщении — аргументы так, как их написали, а не токены parseArgs: группа -dev
  // разворачивается в три токена -d -e -v, а «--» перед аргументом вовсе не попадает в его токен.
  // Поэтому собираем номера непонятых аргументов (Set убирает повторы от групп) и берём по ним args
  const unknown = new Set<number>()
  for (const token of tokens) {
    if (token.kind === 'option' && token.name === 'dev' && token.value === undefined) continue
    unknown.add(token.index)
  }
  if (unknown.size > 0) {
    return {
      success: false,
      error:
        `Непонятные аргументы API: ${[...unknown].map((index) => args[index]).join(' ')}. ` +
        'Принимается только --dev (учебный режим для разработки, его ставит pnpm dev)',
    }
  }
  return { success: true, dev: values.dev === true }
}

export function loadConfig(options: ConfigOptions = {}): Config {
  // .env необязателен: в проде переменные приходят из окружения
  if (existsSync('.env')) process.loadEnvFile('.env')

  const parsed = parseConfig(process.env, options)
  if (!parsed.success) {
    console.error(`Ошибка в переменных окружения:\n${z.prettifyError(parsed.error)}`)
    process.exit(1)
  }
  return parsed.data
}
