import type { SecretBox } from '../crypto/secret-box'
import { SecretBoxError } from '../crypto/secret-box'
import type { Db } from '../db/client'
import {
  MAIL_OFF_EFFECT,
  type Mailer,
  type MailStatus,
  type OutgoingMail,
  type SmtpDiagnosis,
  type SmtpSettings,
} from './mailer'
import { MAIL_PASSWORD_CONTEXT, mailSettingsRepo, type StoredMailSettings } from './settings'

// Почта процесса API: какой провайдер сейчас и откуда настройки. Приоритет: окружение
// (SMTP_HOST или явный MAIL_TRANSPORT) → настройки из админки (mail_settings) → вариант
// по умолчанию (файловый ящик в учебном режиме, иначе выключено). Настройки в админке меняются
// без перезапуска: маршруты спрашивают status(), обработчик очереди — mailer() перед каждым
// письмом. Без Node API: SMTP создают фабрики (smtp), которые передают index.ts и testing.ts

/** Откуда настройки почты: окружение, админка (база) или ниоткуда — тогда вариант по умолчанию */
export type MailSource = 'env' | 'database' | 'none'

/** SMTP без пароля: так его настройки видят админка и лог */
export type SmtpPublicSettings = Omit<SmtpSettings, 'password'>

/** Почта, которую решило окружение. Она главнее настроек из админки */
export type EnvMail =
  | { kind: 'smtp'; mailer: Mailer; settings: SmtpPublicSettings }
  | { kind: 'file'; mailer: Mailer }
  | { kind: 'off'; reason: string }

/** Что работает, когда SMTP не задан ни в окружении, ни в админке */
export type DefaultMail = { mailer: Mailer } | { reason: string }

/**
 * Как создать SMTP из настроек админки и проверить подключение. В index.ts — nodemailer
 * с подсказками для админки, в тестах — ещё и с CA тестового сервера
 */
export type SmtpFactory = {
  mailer(settings: SmtpSettings): Mailer
  diagnose(settings: SmtpSettings, mail: OutgoingMail): Promise<SmtpDiagnosis>
}

export type MailRuntimeOptions = {
  db: Db
  /** Почта из окружения. Нет — окружение почту не решало */
  env?: EnvMail
  fallback: DefaultMail
  /** Шифрование пароля SMTP. Нет ключа (MAIL_ENCRYPTION_KEY) — SMTP в админке только для чтения */
  secretBox?: SecretBox
  /** Какой ключ: свой (env) или учебный из репозитория (dev, только pnpm dev) */
  keyKind?: 'env' | 'dev'
  smtp: SmtpFactory
  /**
   * Куда сказать, что настройки после смены перечитать не вышло (сбой базы сразу после коммита).
   * index.ts пишет в лог через errorForLog: в ошибке базы бывают параметры запроса
   */
  logError?: (message: string, error: unknown) => void
}

/**
 * Почему пароль из базы не читается: нет ключа, ключ не тот, запись повреждена или не того формата.
 * Админка по нему подсказывает, что делать
 */
export type PasswordProblem = 'no_key' | SecretBoxError['problem']

/** Пароль из базы: расшифрован или почему нет (текст для владельца, без секретов) */
export type StoredPassword =
  | { ok: true; password: string }
  | { ok: false; reason: string; problem: PasswordProblem }

const KEY_MISSING =
  'Настройки SMTP сохранены в админке, но API запущен без MAIL_ENCRYPTION_KEY, и пароль SMTP ' +
  'не расшифровать. Верните прежний ключ в окружение API — или задайте новый и введите пароль ' +
  'SMTP заново на странице «Почта»'

const RELOAD_FAILED =
  'API не смог перечитать настройки почты из базы после их изменения. Письма ждут: API ' +
  `пробует снова перед каждым проходом очереди. ${MAIL_OFF_EFFECT}`

const unreadable: Record<SecretBoxError['problem'], string> = {
  wrong_key:
    'Пароль SMTP в базе зашифрован другим ключом: MAIL_ENCRYPTION_KEY сменился. Введите пароль ' +
    'SMTP заново на странице «Почта» (или верните прежний ключ)',
  corrupted:
    'Пароль SMTP в базе не расшифровывается: запись повреждена. Введите пароль SMTP заново ' +
    'на странице «Почта»',
  format:
    'Пароль SMTP в базе не расшифровывается: запись не в том формате. Введите пароль SMTP ' +
    'заново на странице «Почта»',
}

/**
 * Пароль SMTP из строки настроек: расшифрован или почему нет. Так же решают и команды
 * (pnpm member:invite, cli/common.ts): письмо, которое API не сможет отправить, в очередь не ставят
 */
export function readStoredPassword(
  secretBox: SecretBox | undefined,
  row: Pick<StoredMailSettings, 'passwordEncrypted'>,
): StoredPassword {
  if (!secretBox) return { ok: false, reason: KEY_MISSING, problem: 'no_key' }
  try {
    return { ok: true, password: secretBox.decrypt(row.passwordEncrypted, MAIL_PASSWORD_CONTEXT) }
  } catch (error) {
    if (!(error instanceof SecretBoxError)) throw error
    return { ok: false, reason: unreadable[error.problem], problem: error.problem }
  }
}

/** Почему почта выключена, если пароль SMTP из админки не читается: для API и команд одно */
export const unreadablePasswordReason = (reason: string) => `${reason}. ${MAIL_OFF_EFFECT}`

type State = {
  source: MailSource
  status: MailStatus
  mailer?: Mailer
  /** Провайдер создан из настроек админки: при смене его закрываем (чужих не трогаем) */
  own: boolean
}

export function createMailRuntime({
  db,
  env,
  fallback,
  secretBox,
  keyKind,
  smtp,
  logError = () => {},
}: MailRuntimeOptions) {
  const repo = mailSettingsRepo(db)
  const readPassword = (row: StoredMailSettings) => readStoredPassword(secretBox, row)

  function envState(mail: EnvMail): State {
    if (mail.kind === 'off') {
      return { source: 'env', status: { enabled: false, reason: mail.reason }, own: false }
    }
    return {
      source: 'env',
      mailer: mail.mailer,
      status: { enabled: true, provider: mail.mailer.info },
      own: false,
    }
  }

  function fallbackState(): State {
    if ('mailer' in fallback) {
      return {
        source: 'none',
        mailer: fallback.mailer,
        status: { enabled: true, provider: fallback.mailer.info },
        own: false,
      }
    }
    return { source: 'none', status: { enabled: false, reason: fallback.reason }, own: false }
  }

  /**
   * Состояние по окружению и базе. Пароль не расшифровался — почта выключена с причиной (её
   * печатает index.ts при старте и показывает страница «Почта»)
   */
  async function resolve(): Promise<State> {
    if (env) return envState(env)
    const row = await repo.get()
    if (!row) return fallbackState()
    const password = readPassword(row)
    if (!password.ok) {
      return {
        source: 'database',
        status: { enabled: false, reason: unreadablePasswordReason(password.reason) },
        own: false,
      }
    }
    const mailer = smtp.mailer({
      host: row.host,
      port: row.port,
      security: row.security,
      user: row.username,
      password: password.password,
      from: { address: row.fromAddress, name: row.fromName },
    })
    return {
      source: 'database',
      mailer,
      status: { enabled: true, provider: mailer.info },
      own: true,
    }
  }

  // До reload() — то, что известно без базы: окружение или вариант по умолчанию
  let state: State = env ? envState(env) : fallbackState()
  // Идёт смена настроек (exclusive): mailer() ждёт её конца
  let gate: Promise<unknown> = Promise.resolve()
  // Настройки поменялись, а перечитать их не вышло: состояние не знает, какая почта сейчас
  let stale = false

  /** Сменить состояние; провайдер из прежних настроек админки — закрыть */
  async function enter(next: State) {
    const previous = state
    state = next
    // SMTP-провайдер не держит соединений между письмами: закрыть его безопасно и посреди отправки
    if (previous.own && previous.mailer !== next.mailer) await previous.mailer?.close()
  }

  async function reload() {
    await enter(await resolve())
    stale = false
  }

  /**
   * Перечитать после смены настроек. Смена уже закоммичена, поэтому сбой здесь не бросается
   * наружу (иначе маршрут ответил бы 500 и не записал в журнал то, что поменялось), а ставит
   * почту на паузу: прежний провайдер уже не тот (после удаления настроек письма ушли бы через
   * удалённый SMTP). mailer() перед каждым письмом пробует перечитать снова
   */
  async function settle() {
    try {
      await reload()
    } catch (error) {
      stale = true
      await enter({
        source: state.source,
        status: { enabled: false, reason: RELOAD_FAILED },
        own: false,
      }).catch(() => {})
      logError('Почта: API не смог перечитать настройки почты после их изменения', error)
    }
  }

  /** Секция, в которой меняется состояние: mailer() ждёт её конца, секции идут по одной */
  async function guarded<T>(fn: () => Promise<T>): Promise<T> {
    const previous = gate
    let release = () => {}
    gate = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await previous
      return await fn()
    } finally {
      release()
    }
  }

  return {
    /** Почта сейчас: включена ли и через что (без секретов) */
    status: () => state.status,
    /** Откуда сейчас настройки */
    source: () => state.source,
    /**
     * Нынешний провайдер для очередного письма. Пока идёт смена настроек (exclusive), ждёт её
     * конца: письмо, взятое из очереди после коммита новых настроек, уйдёт уже по ним. Если
     * после смены настройки перечитать не вышло, пробует снова
     */
    async mailer() {
      await gate
      if (stale) {
        await guarded(async () => {
          if (stale) await settle()
        })
      }
      return state.mailer
    },
    /**
     * Смена настроек: fn пишет в базу (настройки и письма в очередь одной транзакцией), потом
     * провайдер пересобирается. Всё это время обработчик очереди ждёт в mailer(). Смены идут
     * по одной. Ошибка fn — наружу (ничего не поменялось); сбой пересборки после неё — нет:
     * смена уже в базе, почта встаёт на паузу до следующей попытки (settle)
     */
    exclusive<T>(fn: () => Promise<T>): Promise<T> {
      return guarded(async () => {
        const result = await fn()
        await settle()
        return result
      })
    },
    /** Перечитать настройки из базы и пересобрать провайдера (при старте API). Сбой — наружу */
    reload,
    /** Пароль SMTP из строки настроек: расшифрован или почему нет */
    readPassword,
    /** Какой будет почта без настроек в админке (после их удаления), если окружение не решало */
    fallbackStatus: () => fallbackState().status,
    /** Почта из окружения: тогда настройки из админки не действуют и только для чтения */
    env,
    /** Шифрование пароля SMTP; нет — нет ключа MAIL_ENCRYPTION_KEY */
    secretBox,
    keyKind,
    /** Проверка подключения по шагам (кнопка «Проверить подключение») */
    diagnose: (settings: SmtpSettings, mail: OutgoingMail) => smtp.diagnose(settings, mail),
    /** Закрыть провайдеров при остановке API */
    async close() {
      if (state.own) await state.mailer?.close()
      if (env && env.kind !== 'off') await env.mailer.close()
      if ('mailer' in fallback) await fallback.mailer.close()
    },
  }
}

export type MailRuntime = ReturnType<typeof createMailRuntime>
