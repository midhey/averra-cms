import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { z } from 'zod'

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
 * Адрес без пути: с ним сравнивается заголовок Origin, а в нём пути не бывает.
 * Zod 4 гоняет проверки и после проваленной z.url, поэтому сначала URL.canParse: иначе на
 * пустой строке (так часто «снимают» переменную в compose) падал бы new URL, а не конфиг
 */
const Origin = z
  .url({ protocol: /^https?$/ })
  .refine((url) => !URL.canParse(url) || new URL(url).origin === url, {
    error: 'Нужен адрес без пути и косой черты в конце, например https://admin.example.ru',
  })

const LOOPBACK_HOST = /^(localhost|[a-z0-9.-]+\.localhost|127(\.\d{1,3}){3}|\[::1\])$/i

/** Имя этого компьютера: localhost, *.localhost, 127.x.x.x или [::1] */
export const isLoopbackHost = (hostname: string) => LOOPBACK_HOST.test(hostname)

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

const envSchema = (options: ConfigOptions) =>
  z
    .object({
      // Без NODE_ENV — разработка. Если забыть NODE_ENV=production на сервере, учебный секрет
      // всё равно не пройдёт: без флага --dev учебного режима нет (см. isLocalDev)
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      PORT: z.coerce.number().int().positive().default(4000),
      // Папка встроенного Postgres (PGlite) для разработки. Для прода появится DATABASE_URL
      PGLITE_DIR: z.string().min(1).default('.data/pglite'),
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
