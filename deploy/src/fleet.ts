import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { BackupRun, InstallationStatus, setupZodMessages } from '@averra/schema'
import { z } from 'zod'

// Несколько установок студии: состояние всех и «обновить все» по очереди.
// Список серверов — файл на машине студии вне репозитория (~/.config/averra/servers.txt): в папке
// deploy/ он уехал бы на сервер клиента вместе с установщиком. Доступ — SSH по ключам. На каждом
// сервере команды выполняет deploy/averra.sh (его ставит install.sh), сама команда здесь только
// ходит по SSH и разбирает ответы. Исполнитель ssh приходит параметром: тесты его подменяют

export const usage = `Установки студии по списку серверов.

  pnpm fleet status [--file <список>]
  pnpm fleet update --version <версия> [--only <имя,имя>] [--file <список>]

status — состояние каждой установки (averra.sh status --json по SSH): версия, база, бэкап,
         почта и проблемы. Код выхода 1, если где-то проблема или сервер не ответил.
update — averra.sh update на каждом сервере по очереди; первая ошибка останавливает обход.
         На сервере обновление идёт отдельно от SSH: обрыв связи или Ctrl+C его не прервут,
         а повтор той же команды покажет ход идущего или доведёт оборвавшееся.

Список — ~/.config/averra/servers.txt (или AVERRA_SERVERS, или --file; пример —
deploy/servers.example.txt), строка на сервер:
  <имя> <пользователь@хост> [port=<порт>] [dir=<папка установки>]
Список не держите в deploy/: эта папка уезжает на серверы клиентов, а им чужие адреса ни к чему.
SSH только по ключам (BatchMode): пароль не спрашивается, неизвестный ключ хоста — отказ.
Первый вход на сервер — руками, сверив отпечаток ключа.`

export type Server = { name: string; target: string; port?: number; dir: string }

const NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/
// Без пробелов и кавычек: строка идёт аргументом ssh. Ведущий «-» сделал бы из неё флаг ssh
const TARGET = /^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+$|^[A-Za-z0-9.-]+$/
const DIR = /^\/[A-Za-z0-9_./-]*$/

/** Разбор списка серверов: пустые строки и # — пропуск, кривая строка — ошибка с номером */
export function parseServers(text: string): Server[] {
  const servers: Server[] = []
  const errors: string[] = []
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const parsed = parseServerLine(line, servers)
    if (typeof parsed === 'string') errors.push(`строка ${index + 1}: ${parsed}`)
    else servers.push(parsed)
  }
  if (errors.length > 0) throw new Error(`Список серверов с ошибками:\n${errors.join('\n')}`)
  return servers
}

/** Строка списка: сервер или что в ней не так */
function parseServerLine(line: string, known: Server[]): Server | string {
  const [name = '', target = '', ...rest] = line.split(/\s+/)
  if (!NAME.test(name)) return `имя «${name}» — латиница, цифры, - и _`
  if (!TARGET.test(target) || target.startsWith('-')) return `«${target}» — не пользователь@хост`
  const server: Server = { name, target, dir: '/opt/averra' }
  for (const option of rest) {
    const [key, value = ''] = option.split('=', 2)
    if (key === 'port' && /^\d{1,5}$/.test(value) && Number(value) <= 65535) {
      server.port = Number(value)
    } else if (key === 'dir' && DIR.test(value) && !value.includes('..')) {
      server.dir = value.replace(/\/$/, '') || '/'
    } else {
      return `непонятное «${option}» (port=<порт> или dir=<папка>)`
    }
  }
  if (known.some((server) => server.name === name)) return `имя «${name}» уже есть`
  return server
}

export type ExecResult = { code: number; stdout: string; stderr: string }
/** Исполнитель команды. stream — выводить по ходу (обновление идёт минуты) */
export type Exec = (
  command: string,
  args: string[],
  options?: { stream?: (line: string) => void },
) => Promise<ExecResult>

/** Аргументы ssh: только ключи, без вопросов, с таймаутом соединения */
export function sshArgs(server: Server, remote: string) {
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    ...(server.port ? ['-p', String(server.port)] : []),
    '--',
    server.target,
    remote,
  ]
}

const script = (server: Server) => `${server.dir}/averra.sh`

/**
 * Обновление на сервере, когда API не ответил: идёт (API остановлен на его время), оборвалось
 * на полпути (повтор update доведёт его) или нет. Ответ прежнего averra.sh этого поля не знает
 */
const UpdateNote = z.enum(['running', 'interrupted', 'none']).catch('none')
export type UpdateNote = z.infer<typeof UpdateNote>

/** Ответ averra.sh status --json, когда API не ответил: что известно без него */
const ApiDown = z.object({
  apiDown: z.literal(true),
  configuredVersion: z.string().nullable(),
  backupLast: BackupRun.nullable(),
  update: UpdateNote,
})

export type ServerStatus =
  | { server: Server; kind: 'ok'; status: InstallationStatus }
  | {
      server: Server
      kind: 'api-down'
      version: string | null
      backup: BackupRun | null
      update: UpdateNote
    }
  | { server: Server; kind: 'unreachable'; reason: string }

function lastLine(text: string) {
  return text.trim().split('\n').at(-1)?.trim() ?? ''
}

export async function serverStatus(server: Server, exec: Exec): Promise<ServerStatus> {
  const result = await exec('ssh', sshArgs(server, `sudo -n ${script(server)} status --json`))
  let json: unknown
  try {
    json = JSON.parse(lastLine(result.stdout))
  } catch {
    // 255 — ssh не соединился (ключ, хост, сеть); остальное — скрипт на сервере ответил не JSON
    const reason =
      result.code === 255
        ? `SSH: ${lastLine(result.stderr) || 'нет соединения'}`
        : lastLine(result.stderr) || `averra.sh status ответил не JSON (код ${result.code})`
    return { server, kind: 'unreachable', reason }
  }
  const status = InstallationStatus.safeParse(json)
  if (status.success) return { server, kind: 'ok', status: status.data }
  const down = ApiDown.safeParse(json)
  if (down.success) {
    return {
      server,
      kind: 'api-down',
      version: down.data.configuredVersion,
      backup: down.data.backupLast,
      update: down.data.update,
    }
  }
  return {
    server,
    kind: 'unreachable',
    reason: 'ответ состояния не по схеме: другая версия Averra?',
  }
}

const ago = (iso: string, now: Date) => {
  const hours = Math.round((now.getTime() - Date.parse(iso)) / 3_600_000)
  return hours < 48 ? `${hours} ч назад` : `${Math.round(hours / 24)} дн назад`
}

/** Строка таблицы состояния: сервер, версия, база, бэкап, почта, проблемы */
export function statusRow(item: ServerStatus, now: Date): string[] {
  const { name } = item.server
  if (item.kind === 'unreachable') return [name, '?', '?', '?', '?', item.reason]
  if (item.kind === 'api-down') {
    const backup = item.backup
      ? `${item.backup.ok ? 'ок' : 'сбой'}, ${ago(item.backup.finishedAt, now)}`
      : '—'
    const problem = {
      running: 'API не отвечает: идёт обновление',
      interrupted: 'API не отвечает: обновление оборвалось — повторите pnpm fleet update',
      none: 'API не отвечает',
    }[item.update]
    return [name, item.version ?? '?', '?', backup, '?', problem]
  }
  const { status } = item
  const last = status.backup.lastOk
  const backup = !status.backup.enabled
    ? 'не ведётся'
    : last
      ? `ок, ${ago(last.finishedAt, now)}`
      : 'не было'
  const mail = !status.mail.enabled
    ? 'выключена'
    : status.mail.failing > 0
      ? `с ошибкой ${status.mail.failing}`
      : status.mail.failedRecent > 0
        ? `не ушло ${status.mail.failedRecent}`
        : 'ок'
  const problems = status.problems.map((problem) => problem.message).join('; ') || '—'
  return [name, status.version, status.db.up ? 'ок' : 'лежит', backup, mail, problems]
}

export function formatTable(rows: string[][]) {
  const header = ['Сервер', 'Версия', 'База', 'Бэкап', 'Почта', 'Проблемы']
  const all = [header, ...rows]
  const widths = header.map((_, column) =>
    Math.max(...all.map((row) => (row[column] ?? '').length)),
  )
  return all
    .map((row) =>
      row
        .map((cell, column) =>
          column === header.length - 1 ? cell : cell.padEnd(widths[column] ?? 0),
        )
        .join('  '),
    )
    .join('\n')
}

const healthy = (item: ServerStatus) => item.kind === 'ok' && item.status.problems.length === 0

/** Состояние всех установок по очереди: таблица и код выхода (1 — где-то проблема) */
export async function fleetStatus(servers: Server[], exec: Exec, now = new Date()) {
  const items: ServerStatus[] = []
  for (const server of servers) items.push(await serverStatus(server, exec))
  return {
    items,
    table: formatTable(items.map((item) => statusRow(item, now))),
    code: items.every(healthy) ? 0 : 1,
  }
}

export type UpdateOutcome = {
  updated: string[]
  failed?: { name: string; code: number }
  skipped: string[]
}

/**
 * Обновление по очереди с остановкой на первой ошибке: сломалось на одном — остальные не трогаем,
 * пока человек не разберётся (откат averra.sh уже вернул тот сервер на прежнюю версию)
 */
export async function fleetUpdate(
  servers: Server[],
  version: string,
  exec: Exec,
  log: (line: string) => void,
): Promise<UpdateOutcome> {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(version)) {
    throw new Error(`«${version}» — не версия (например, 0.7.0)`)
  }
  const updated: string[] = []
  for (const [index, server] of servers.entries()) {
    log(`\n==> ${server.name} (${server.target}): обновление до ${version}`)
    const result = await exec(
      'ssh',
      sshArgs(server, `sudo -n ${script(server)} update --version ${version} --yes`),
      { stream: (line) => log(`[${server.name}] ${line}`) },
    )
    if (result.code !== 0) {
      return {
        updated,
        failed: { name: server.name, code: result.code },
        skipped: servers.slice(index + 1).map((rest) => rest.name),
      }
    }
    updated.push(server.name)
  }
  return { updated, skipped: [] }
}

export function describeOutcome(outcome: UpdateOutcome) {
  const lines = [`Обновлены: ${outcome.updated.join(', ') || 'ни один'}`]
  if (outcome.failed) {
    const { name, code } = outcome.failed
    lines.push(
      code === 2
        ? `Сломалось на ${name}: откат не удался — нужен человек на сервере (averra.sh status)`
        : code === 3
          ? `Сломалось на ${name}: процесс обновления на сервере оборвался — повторите pnpm fleet update, он доведёт прерванное (закончит или откатит)`
          : code === 255
            ? `Сломалось на ${name}: SSH-соединение оборвалось или не установилось. Обновление на сервере идёт отдельно от SSH и доработает само: итог — pnpm fleet status, повтор pnpm fleet update покажет ход идущего`
            : `Сломалось на ${name}: обновление не прошло, сервер на прежней версии (вывод выше)`,
      `Не трогали: ${outcome.skipped.join(', ') || '—'}`,
    )
  }
  return lines.join('\n')
}

/** Настоящий исполнитель: процесс без оболочки, аргументы — массивом */
export const spawnExec: Exec = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let pending = ''
    const onData = (chunk: Buffer, sink: 'out' | 'err') => {
      const text = chunk.toString('utf8')
      if (sink === 'out') stdout += text
      else stderr += text
      if (options.stream) {
        pending += text
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) options.stream(line)
      }
    }
    child.stdout.on('data', (chunk: Buffer) => onData(chunk, 'out'))
    child.stderr.on('data', (chunk: Buffer) => onData(chunk, 'err'))
    child.on('error', (error) =>
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` }),
    )
    child.on('close', (code) => {
      if (options.stream && pending) options.stream(pending)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })

type Env = Record<string, string | undefined>

/**
 * Где список серверов: --file (относительный путь — от папки, где запустили pnpm, а не от
 * deploy/, куда pnpm переходит сам), иначе AVERRA_SERVERS, иначе ~/.config/averra/servers.txt
 */
export function serversFile(file: string | undefined, env: Env, home = homedir()) {
  const from = env.INIT_CWD ?? process.cwd()
  if (file) return resolvePath(from, file)
  if (env.AVERRA_SERVERS) return resolvePath(from, env.AVERRA_SERVERS)
  return join(home, '.config', 'averra', 'servers.txt')
}

export async function main(
  argv: string[],
  exec: Exec = spawnExec,
  log = console.log,
  env: Env = process.env,
) {
  setupZodMessages()
  const [command, ...rest] = argv
  if (command !== 'status' && command !== 'update') {
    log(usage)
    return command === undefined || command === 'help' || command === '--help' ? 0 : 1
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      file: { type: 'string' },
      version: { type: 'string' },
      only: { type: 'string' },
    },
    strict: true,
  })
  let text: string
  const file = serversFile(values.file, env)
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    throw new Error(
      `Нет списка серверов ${file}. Пример — deploy/servers.example.txt; путь — --file или AVERRA_SERVERS`,
    )
  }
  let servers = parseServers(text)
  if (values.only) {
    const only = values.only.split(',').map((name) => name.trim())
    const unknown = only.filter((name) => !servers.some((server) => server.name === name))
    if (unknown.length > 0) throw new Error(`Нет в списке: ${unknown.join(', ')}`)
    servers = servers.filter((server) => only.includes(server.name))
  }
  if (servers.length === 0) throw new Error(`В ${file} нет серверов`)

  if (command === 'status') {
    const result = await fleetStatus(servers, exec)
    log(result.table)
    return result.code
  }
  if (!values.version) throw new Error('Нужна версия: pnpm fleet update --version 0.7.0')
  const outcome = await fleetUpdate(servers, values.version, exec, log)
  log(`\n${describeOutcome(outcome)}`)
  return outcome.failed ? 1 : 0
}

// Запуск командой (pnpm fleet …), а не импорт в тесте
if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      console.error((error as Error).message)
      process.exitCode = 1
    },
  )
}
