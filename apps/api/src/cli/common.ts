import { mkdirSync } from 'node:fs'
import { type ParseArgsOptionsConfig, parseArgs } from 'node:util'
import { setupZodMessages } from '@averra/schema'
import { z } from 'zod'
import { createAuth } from '../auth/auth'
import { isLoopbackHost, loadConfig, type MailConfig } from '../config'
import { createDb, type Db } from '../db/client'
import { DbLockedError, lockDb } from '../db/lock'
import { migrateDb } from '../db/migrate'
import { mailSettingsRepo } from '../mail/settings'

// Общее для команд терминала (pnpm user:create, token:create…): аргументы, скрытый ввод
// пароля и открытие базы. Команды работают с базой напрямую, как API, а не через HTTP:
// первый владелец появляется раньше, чем есть кому войти

/** Ошибка, которую команда показывает человеку как есть, без стека */
export class CliError extends Error {
  override name = 'CliError'
}

/** Аргументы вида --email a@b.ru. Неизвестный аргумент — ошибка, а не молчаливый пропуск */
export function args<T extends ParseArgsOptionsConfig>(options: T, usage: string) {
  try {
    return parseArgs({ options, strict: true, allowPositionals: false }).values
  } catch (error) {
    throw new CliError(`${(error as Error).message}\n\n${usage}`)
  }
}

/** Проверка аргументов схемой: сообщение по каждому кривому аргументу */
export function check<S extends z.ZodType>(schema: S, value: unknown, usage: string): z.output<S> {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new CliError(`${z.prettifyError(parsed.error)}\n\n${usage}`)
}

/** База и Better Auth той же конфигурации, что у API. Пока API запущен, база занята */
export async function openDb() {
  // Учебный секрет команде не опасен: она не слушает сеть, а Better Auth нужен ей только для
  // хеша пароля, который от секрета не зависит. Демо-сайт и владельца команды не заводят.
  // Без этого pnpm user:create на свежем клоне требовал бы AUTH_SECRET в .env
  const config = loadConfig({ dev: true })
  mkdirSync(config.PGLITE_DIR, { recursive: true })
  const unlock = await lockDb(config.PGLITE_DIR).catch((error: unknown) => {
    if (!(error instanceof DbLockedError)) throw error
    throw new CliError(
      `База ${config.PGLITE_DIR} открыта процессом ${error.pid ?? '(неизвестно)'} — скорее всего, это API из pnpm dev.\n` +
        'Встроенная база не выдерживает два процесса сразу: останови pnpm dev и повтори команду.\n' +
        error.hint,
    )
  })
  const { db, close } = createDb(config.PGLITE_DIR)
  const closeAll = async () => {
    await close()
    unlock()
  }
  try {
    await migrateDb(db)
  } catch (error) {
    await closeAll()
    throw error
  }
  const auth = createAuth({
    db,
    secret: config.AUTH_SECRET,
    baseURL: config.API_URL,
    adminUrl: config.ADMIN_URL,
    secureCookies: config.secureCookies,
    quiet: true,
  })
  return { db, auth, config, close: closeAll }
}

/** Запускает команду: CliError — короткое сообщение и код 1, остальное — со стеком */
export async function run(main: () => Promise<void>) {
  // Ошибки аргументов — по-русски, как в API и админке
  setupZodMessages()
  try {
    await main()
  } catch (error) {
    if (error instanceof CliError) console.error(error.message)
    else console.error(error)
    process.exitCode = 1
  }
}

/**
 * Пароль: из переменной окружения или скрытым вводом дважды. Ни сам пароль, ни его длина
 * не выводятся. Без терминала (ввод из файла или конвейера) спросить скрыто нельзя
 */
export async function readNewPassword(envName: string) {
  const fromEnv = process.env[envName]
  if (fromEnv !== undefined) return fromEnv
  if (!process.stdin.isTTY) {
    throw new CliError(`Нет терминала для скрытого ввода пароля. Передай его в ${envName}.`)
  }
  const password = await readHidden('Пароль (не отображается): ')
  const repeat = await readHidden('Ещё раз: ')
  if (password !== repeat) throw new CliError('Пароли не совпали')
  return password
}

function readHidden(prompt: string) {
  const { stdin, stderr } = process
  return new Promise<string>((resolve, reject) => {
    let value = ''
    const finish = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stderr.write('\n')
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish()
          resolve(value)
          return
        }
        // Ctrl+C и Ctrl+D: в сыром режиме терминал их не обрабатывает, делаем сами
        if (char === '\u0003' || char === '\u0004') {
          finish()
          reject(new CliError('Отменено'))
          return
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else if (char >= ' ') value += char
      }
    }
    stderr.write(prompt)
    stdin.setEncoding('utf8')
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  })
}

/**
 * Куда ведёт ссылка из письма, которое команда кладёт в очередь (приглашение). Очередь общая:
 * письмо разошлёт тот API, что запустится, — в том числе продовый по SMTP. Поэтому команда
 * всегда говорит, на какой адрес админки ведёт ссылка (сам токен — нет). Ссылка на localhost
 * при настоящей почте (SMTP) — почти наверняка забытый ADMIN_URL: отказ. При файловом ящике
 * (разработка) — предупреждение: если команда запущена на сервере без его переменных, письмо
 * со ссылкой на localhost всё равно уйдёт, когда его заберёт продовый API
 */
export function inviteLinkNotice(adminUrl: string, transport: string) {
  const local = isLoopbackHost(new URL(adminUrl).hostname)
  if (local && transport === 'smtp') {
    throw new CliError(
      `ADMIN_URL ведёт на ${adminUrl}, а письмо уйдёт по SMTP: адресат не откроет ссылку на localhost.\n` +
        'Задай ADMIN_URL — адрес админки, как у API, — и повтори',
    )
  }
  const lines = [`Ссылка в письме ведёт в админку ${adminUrl}.`]
  if (local) {
    lines.push(
      'Это адрес на этом компьютере. Если команда запущена на сервере, задай ADMIN_URL, как у API, ' +
        'и пригласи заново: прежнее приглашение отзовётся само',
    )
  }
  return lines
}

/**
 * Как уйдёт письмо, которое команда кладёт в очередь (приглашение). Решило окружение — по нему;
 * иначе SMTP из админки, если он там задан (команда открывает базу, а пароль ей не нужен — письмо
 * отправит API); иначе вариант по умолчанию: файловый ящик в разработке или выключено
 */
export async function queuedMailTransport(
  db: Db,
  mail: MailConfig,
): Promise<{ transport: 'smtp' | 'file' } | { transport: 'off'; reason: string }> {
  if (!mail.fromEnv && (await mailSettingsRepo(db).get())) return { transport: 'smtp' }
  return mail.transport === 'off'
    ? { transport: 'off', reason: mail.reason }
    : { transport: mail.transport }
}
