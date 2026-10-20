import { eq } from 'drizzle-orm'
import type { SessionUser } from '../../auth/access'
import type { Db } from '../../db/client'
import { users } from '../../db/schema'
import type { CheckTokens } from '../../mail/check-token'
import { describeMailer, type MailerInfo, type MailStatus } from '../../mail/mailer'
import { enqueueMail } from '../../mail/outbox'
import type { MailRuntime, MailSource, PasswordProblem } from '../../mail/runtime'
import {
  changedFields,
  MAIL_PASSWORD_CONTEXT,
  type MailSettingsField,
  type MailSettingsShape,
  mailSettingsFieldLabels,
  mailSettingsRepo,
  type StoredMailSettings,
  shapeOf,
} from '../../mail/settings'
import { toMailLine } from '../../mail/templates/line'

// Настройки SMTP в админке: что показать, где взять пароль для проверки и как сохранить или
// удалить с письмом владельцам. Права, схемы, повторный пароль и лимиты — в routes.ts.
// Пароль наружу не отдаётся никогда: в view только «задан» или «не читается»

/** Почему SMTP в админке только для чтения */
export type SmtpLock = { reason: 'env' | 'no_key'; message: string }

/** Настройки SMTP для админки — без пароля, даже зашифрованного */
export type SmtpView = {
  /** Откуда берутся настройки: окружение (главнее), админка или нигде (вариант по умолчанию) */
  source: MailSource
  /** Можно ли менять в админке. Нет — почему, в lock */
  editable: boolean
  lock: SmtpLock | null
  /** Ключ шифрования: свой, учебный (pnpm dev) или его нет */
  key: 'env' | 'dev' | null
  settings:
    | null
    | (MailSettingsShape & {
        /** set — задан и читается, unreadable — задан, но не расшифровывается */
        password: 'set' | 'unreadable'
        /**
         * Почему не расшифровывается: нет ключа (no_key), ключ не тот (wrong_key), запись
         * повреждена (corrupted) или не того формата (format). Читается — null
         */
        passwordProblem: PasswordProblem | null
        verifiedAt: Date | null
        updatedAt: Date | null
        /** Кто сохранил последним (имя) */
        updatedBy: string | null
      })
}

const RESTART = 'и перезапустите его'

const envLocks: Record<'smtp' | 'file' | 'off', string> = {
  smtp:
    'SMTP задан на сервере — в переменных окружения API (SMTP_HOST и другие), и они главнее ' +
    `настроек в админке. Чтобы менять SMTP здесь, уберите SMTP_* из окружения API ${RESTART}`,
  file:
    'Почта задана на сервере: MAIL_TRANSPORT=file (файловый ящик для разработки). Чтобы задать ' +
    `SMTP здесь, уберите MAIL_TRANSPORT из окружения API ${RESTART}`,
  off:
    'Почта выключена на сервере: MAIL_TRANSPORT=off. Чтобы задать SMTP здесь, уберите ' +
    `MAIL_TRANSPORT из окружения API ${RESTART}`,
}

const NO_KEY =
  'Чтобы хранить пароль SMTP в базе, API нужен ключ шифрования MAIL_ENCRYPTION_KEY — 32 случайных ' +
  'байта в base64. Сгенерируйте его: openssl rand -base64 32 (или node -e ' +
  `"console.log(require('node:crypto').randomBytes(32).toString('base64'))"), впишите в окружение ` +
  'API (apps/api/.env или переменные сервера) и перезапустите API. Храните ключ отдельно от ' +
  'бэкапов базы: без него пароль SMTP не расшифровать'

/** Почему SMTP в админке не поменять: окружение решило само или нет ключа шифрования */
export function smtpLockOf(runtime: MailRuntime): SmtpLock | null {
  if (runtime.env) return { reason: 'env', message: envLocks[runtime.env.kind] }
  if (!runtime.secretBox) return { reason: 'no_key', message: NO_KEY }
  return null
}

async function userName(db: Db, id: string | null) {
  if (id === null) return null
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, id))
  return user?.name ?? null
}

/** Что показать на странице «Почта»: окружение, настройки из админки или ничего */
export async function smtpView(db: Db, runtime: MailRuntime): Promise<SmtpView> {
  const lock = smtpLockOf(runtime)
  const key = runtime.keyKind ?? null
  const { env } = runtime
  if (env) {
    if (env.kind !== 'smtp') return { source: 'env', editable: false, lock, key, settings: null }
    const { host, port, security, user, from } = env.settings
    return {
      source: 'env',
      editable: false,
      lock,
      key,
      settings: {
        host,
        port,
        security,
        user,
        fromAddress: from.address,
        fromName: from.name,
        password: 'set',
        passwordProblem: null,
        verifiedAt: null,
        updatedAt: null,
        updatedBy: null,
      },
    }
  }
  const row = await mailSettingsRepo(db).get()
  if (!row) return { source: 'none', editable: lock === null, lock, key, settings: null }
  const stored = runtime.readPassword(row)
  return {
    source: 'database',
    editable: lock === null,
    lock,
    key,
    settings: {
      ...shapeOf(row),
      password: stored.ok ? 'set' : 'unreadable',
      passwordProblem: stored.ok ? null : stored.problem,
      verifiedAt: row.verifiedAt,
      updatedAt: row.updatedAt,
      updatedBy: await userName(db, row.updatedBy),
    },
  }
}

/** Пароль SMTP для проверки или сохранения: новый из формы или сохранённый */
export type EffectivePassword =
  | { ok: true; password: string; kept: boolean }
  | { ok: false; message: string }

/**
 * Пустое поле пароля — оставить сохранённый. Но только для того же сервера: иначе уведённая
 * сессия направила бы проверку на свой сервер и получила бы сохранённый пароль в AUTH.
 * И только если он расшифровывается
 */
function effectivePassword(
  runtime: MailRuntime,
  row: StoredMailSettings | undefined,
  input: { host: string; password?: string | undefined },
): EffectivePassword {
  if (input.password) return { ok: true, password: input.password, kept: false }
  if (!row) return { ok: false, message: 'Введите пароль SMTP' }
  if (row.host !== input.host) {
    return {
      ok: false,
      message: `Сервер другой — введите пароль SMTP: сохранённый пароль уходит только на сохранённый сервер (${row.host})`,
    }
  }
  const stored = runtime.readPassword(row)
  if (!stored.ok) {
    return {
      ok: false,
      message: 'Сохранённый пароль SMTP не расшифровывается — введите его заново',
    }
  }
  return { ok: true, password: stored.password, kept: true }
}

/** Настройки из запроса — без пароля и лишних полей, как их сравнивает changedFields */
export const shapeOfInput = (input: MailSettingsShape): MailSettingsShape => ({
  host: input.host,
  port: input.port,
  security: input.security,
  user: input.user,
  fromAddress: input.fromAddress,
  fromName: input.fromName,
})

const labelsOf = (fields: MailSettingsField[]) =>
  fields.map((field) => mailSettingsFieldLabels[field])

/** Пароль SMTP для «Проверить подключение» или почему его нет (path — поле формы с ошибкой) */
export type CheckPassword =
  | { ok: true; password: string; kept: boolean }
  | { ok: false; path: 'password' | 'to'; message: string }

/**
 * Пароль для проверки подключения. Проверка не просит пароль владельца, поэтому сохранённый
 * пароль SMTP в ней работает строже, чем при сохранении: только с сохранёнными настройками
 * целиком (тогда проверочное письмо — фиксированный текст от сохранённого отправителя) и только
 * на почту самого владельца. Иначе уведённая сессия слала бы через настоящий ящик студии (SPF
 * и DKIM проходят) письма со своим логином, адресом и именем отправителя на любые адреса.
 * С паролем, введённым в форму, проверка идёт через ящик того, кто этот пароль знает: ограничений
 * нет
 */
export function checkPasswordOf(
  runtime: MailRuntime,
  row: StoredMailSettings | undefined,
  input: MailSettingsShape & { password?: string | undefined; to: string },
  ownerEmail: string,
): CheckPassword {
  const password = effectivePassword(runtime, row, input)
  if (!password.ok) return { ok: false, path: 'password', message: password.message }
  if (!password.kept || !row) return password
  const changed = changedFields(shapeOf(row), shapeOfInput(input), false)
  if (changed.length > 0) {
    return {
      ok: false,
      path: 'password',
      message:
        `Вы поменяли: ${labelsOf(changed).join(', ')}. С сохранённым паролем SMTP проверка идёт только ` +
        'по сохранённым настройкам — введите пароль SMTP или сохраните без проверки',
    }
  }
  if (input.to.toLowerCase() !== ownerEmail.toLowerCase()) {
    return {
      ok: false,
      path: 'to',
      message:
        `С сохранённым паролем SMTP проверочное письмо уходит только на вашу почту (${ownerEmail}). ` +
        'Чтобы проверить другой адрес, введите пароль SMTP',
    }
  }
  return password
}

/** Провайдер словами для письма и лога: без пароля, одной строкой */
const providerLine = (status: MailStatus) =>
  toMailLine(
    status.enabled ? describeMailer(status.provider) : status.reason,
    300,
    'почта выключена',
  )

/** SMTP из настроек админки — как его опишет describeMailer, без пароля */
export const smtpInfoOf = (shape: MailSettingsShape): MailerInfo => ({
  kind: 'smtp',
  host: shape.host,
  port: shape.port,
  security: shape.security,
  user: shape.user,
  from: { address: shape.fromAddress, name: shape.fromName },
})

type ChangeDeps = {
  db: Db
  runtime: MailRuntime
  log: (message: string) => void
  wake: () => void
}

/** Все владельцы: им уходит письмо «Настройки почты изменены» */
const ownersOf = (db: Db) =>
  db.select({ email: users.email }).from(users).where(eq(users.role, 'owner'))

/**
 * Кто поменял — для лога. Имя одной строкой: имя, заведённое до схемы UserName, могло быть
 * с переводом строки, и в логе оно подделало бы следующую запись
 */
const whoIs = (user: SessionUser) =>
  `${toMailLine(user.name, 100, 'без имени')} <${user.email}> (${user.id})`

export type SaveInput = MailSettingsShape & {
  /** Пустой — оставить прежний */
  password?: string | undefined
  checkToken?: string | undefined
  skipCheck?: true | undefined
}

export type SaveResult =
  | { ok: true; fields: MailSettingsField[]; notified: number }
  | { ok: false; problem: 'password'; message: string }
  | { ok: false; problem: 'check_stale' }

/**
 * Сохраняет настройки (повторный пароль владельца уже проверен). Настройки и письма владельцам —
 * одной транзакцией внутри runtime.exclusive: письмо уйдёт уже по новым настройкам. В лог —
 * кто, когда и какие поля, без значений и пароля
 */
export async function saveSmtp(
  { db, runtime, log, wake }: ChangeDeps,
  checkTokens: CheckTokens,
  input: SaveInput,
  user: SessionUser,
): Promise<SaveResult> {
  const { secretBox } = runtime
  if (!secretBox) throw new Error('Без ключа шифрования настройки SMTP не сохранить')
  const repo = mailSettingsRepo(db)
  const row = await repo.get()
  const password = effectivePassword(runtime, row, input)
  if (!password.ok) return { ok: false, problem: 'password', message: password.message }

  const shape = shapeOfInput(input)
  let verifiedAt: Date | null = null
  if (input.checkToken !== undefined) {
    verifiedAt =
      (await checkTokens.verify(input.checkToken, user.id, {
        ...shape,
        password: password.password,
      })) ?? null
    if (!verifiedAt) return { ok: false, problem: 'check_stale' }
  }

  const previous = row ? runtime.readPassword(row) : undefined
  const passwordChanged =
    !password.kept && !(previous?.ok === true && previous.password === password.password)
  const fields = changedFields(row ? shapeOf(row) : undefined, shape, passwordChanged)
  // Прежний пароль оставляем как лежал; новый — шифруем со свежим IV
  const passwordEncrypted =
    password.kept && row
      ? row.passwordEncrypted
      : secretBox.encrypt(password.password, MAIL_PASSWORD_CONTEXT)
  const now = new Date()
  const owners = fields.length > 0 ? await ownersOf(db) : []

  await runtime.exclusive(() =>
    db.transaction(async (tx) => {
      await repo.save(tx, { ...shape, passwordEncrypted, verifiedAt, updatedBy: user.id }, now)
      for (const owner of owners) {
        await enqueueMail(
          tx,
          {
            template: 'mail-settings-changed',
            data: {
              changedBy: toMailLine(user.name, 100, 'Владелец'),
              changedByEmail: user.email,
              changedAt: now.toISOString(),
              action: 'saved',
              fields: labelsOf(fields),
              provider: providerLine({ enabled: true, provider: smtpInfoOf(shape) }),
              verified: verifiedAt !== null,
            },
            to: owner.email,
          },
          now,
        )
      }
    }),
  )
  // Смена уже в базе: exclusive не бросает, даже если пересобрать провайдера не вышло (тогда почта
  // на паузе до следующей попытки, runtime.ts). Запись в журнал — всегда
  log(
    `[${now.toISOString()}] Настройки почты (SMTP) сохранены в админке: ${whoIs(user)}. ` +
      `Изменено: ${fields.length > 0 ? labelsOf(fields).join(', ') : 'ничего'}. ` +
      `Проверка подключения: ${verifiedAt ? 'пройдена' : 'не делалась (сохранено без проверки)'}`,
  )
  // Обработчик — сразу: письма владельцам, выход из паузы после сбоя сервера на прежних
  // настройках (например, отказа адресу отправителя) и новая попытка перечитать настройки
  wake()
  return { ok: true, fields, notified: owners.length }
}

/**
 * Удаляет настройки из админки: почта возвращается к варианту по умолчанию (файловый ящик
 * в pnpm dev или выключена). Письмо владельцам — если после удаления почта работает
 */
export async function removeSmtp({ db, runtime, log, wake }: ChangeDeps, user: SessionUser) {
  const repo = mailSettingsRepo(db)
  const after = runtime.fallbackStatus()
  const now = new Date()
  // Без почты письмо не отправить, а в очередь при выключенной почте не ставим
  const owners = after.enabled ? await ownersOf(db) : []
  const removed = await runtime.exclusive(() =>
    db.transaction(async (tx) => {
      if (!(await repo.remove(tx))) return false
      for (const owner of owners) {
        await enqueueMail(
          tx,
          {
            template: 'mail-settings-changed',
            data: {
              changedBy: toMailLine(user.name, 100, 'Владелец'),
              changedByEmail: user.email,
              changedAt: now.toISOString(),
              action: 'removed',
              fields: [],
              provider: providerLine(after),
              verified: false,
            },
            to: owner.email,
          },
          now,
        )
      }
      return true
    }),
  )
  if (!removed) return { ok: false as const }
  log(
    `[${now.toISOString()}] Настройки почты (SMTP) удалены из админки: ${whoIs(user)}. ` +
      `Теперь: ${providerLine(after)}`,
  )
  wake()
  return { ok: true as const, notified: owners.length }
}
