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
}: MailRuntimeOptions) {
  const repo = mailSettingsRepo(db)

  function readPassword(row: StoredMailSettings): StoredPassword {
    if (!secretBox) return { ok: false, reason: KEY_MISSING, problem: 'no_key' }
    try {
      return { ok: true, password: secretBox.decrypt(row.passwordEncrypted, MAIL_PASSWORD_CONTEXT) }
    } catch (error) {
      if (!(error instanceof SecretBoxError)) throw error
      return { ok: false, reason: unreadable[error.problem], problem: error.problem }
    }
  }

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
        status: { enabled: false, reason: `${password.reason}. ${MAIL_OFF_EFFECT}` },
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

  async function reload() {
    const next = await resolve()
    const previous = state
    state = next
    // SMTP-провайдер не держит соединений между письмами: закрыть его безопасно и посреди отправки
    if (previous.own && previous.mailer !== next.mailer) await previous.mailer?.close()
  }

  return {
    /** Почта сейчас: включена ли и через что (без секретов) */
    status: () => state.status,
    /** Откуда сейчас настройки */
    source: () => state.source,
    /**
     * Нынешний провайдер для очередного письма. Пока идёт смена настроек (exclusive), ждёт её
     * конца: письмо, взятое из очереди после коммита новых настроек, уйдёт уже по ним
     */
    async mailer() {
      await gate
      return state.mailer
    },
    /**
     * Смена настроек: fn пишет в базу (настройки и письма в очередь одной транзакцией), потом
     * провайдер пересобирается. Всё это время обработчик очереди ждёт в mailer(). Смены идут
     * по одной
     */
    async exclusive<T>(fn: () => Promise<T>): Promise<T> {
      const previous = gate
      let release = () => {}
      gate = new Promise<void>((resolve) => {
        release = resolve
      })
      try {
        await previous
        const result = await fn()
        await reload()
        return result
      } finally {
        release()
      }
    },
    /** Перечитать настройки из базы и пересобрать провайдера (при старте API) */
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
