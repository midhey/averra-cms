import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

// PGlite — база внутри одного процесса: два процесса с одной папкой данных могут её испортить.
// Поэтому API и команды терминала (pnpm user:create, token:create…) берут файл-замок рядом
// с папкой базы. В нём pid владельца: замок от упавшего процесса снимается сам

export class DbLockedError extends Error {
  override name = 'DbLockedError'
  constructor(readonly pid: number) {
    super(`База занята процессом ${pid}`)
  }
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM — процесс есть, просто чужой
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function tryLock(path: string) {
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx' })
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const pid = Number(readFileSync(path, 'utf8'))
  if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && isAlive(pid)) {
    throw new DbLockedError(pid)
  }
  // Замок остался от процесса, которого уже нет: забираем его
  // Забираем через ту же попытку с wx: если другой процесс успел первым, увидим его pid
  rmSync(path, { force: true })
  tryLock(path)
}

/**
 * Берёт замок базы. waitMs — сколько ждать живого владельца: tsx watch перезапускает API
 * быстрее, чем старый процесс успевает выйти. Возвращает функцию, которая отпускает замок
 */
export async function lockDb(dataDir: string, { waitMs = 0 } = {}) {
  const path = `${dataDir.replace(/[\\/]+$/, '')}.lock`
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      tryLock(path)
      break
    } catch (error) {
      if (!(error instanceof DbLockedError) || Date.now() >= deadline) throw error
      await sleep(200)
    }
  }
  return () => {
    // Отпускаем только свой замок: чужой (после ожидания и перехвата) не трогаем
    try {
      if (Number(readFileSync(path, 'utf8')) === process.pid) rmSync(path, { force: true })
    } catch {}
  }
}
