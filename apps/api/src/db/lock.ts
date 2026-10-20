import { linkSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

// PGlite — база внутри одного процесса: два процесса с одной папкой данных могут её испортить.
// Поэтому API и команды терминала (pnpm user:create, token:create…) берут файл-замок рядом
// с папкой базы. В нём pid владельца: замок от упавшего процесса снимается сам

export class DbLockedError extends Error {
  override name = 'DbLockedError'
  constructor(
    /** pid владельца или null, если файл замка пустой или испорчен */
    readonly pid: number | null,
    readonly path: string,
  ) {
    super(`База занята процессом ${pid ?? '(неизвестно)'}`)
  }

  /**
   * Подсказка для человека. Замок мёртвого процесса снимается сам, но на Windows pid быстро
   * переиспользуются: замок упавшего API может «принадлежать» постороннему живому процессу
   */
  get hint() {
    return (
      `Если процесса ${this.pid ?? 'из замка'} нет или это не API и не команда Averra CMS, ` +
      `удали файл замка: ${this.path}`
    )
  }
}

/** Замок без pid младше этого — кто-то прямо сейчас его берёт; старше — мусор после сбоя */
const EMPTY_LOCK_GRACE_MS = 10_000

function isAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM — процесс есть, просто чужой
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readPid(path: string) {
  try {
    const pid = Number(readFileSync(path, 'utf8'))
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch (error) {
    // Замок успели снять между нашими попытками
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Файл замка появляется сразу с pid внутри: pid пишем во временный файл и ставим его на место
 * жёсткой ссылкой. link, как и open с wx, не перезаписывает существующий файл, но, в отличие
 * от него, не оставляет окна, когда замок уже есть, а pid в нём ещё нет
 */
function tryLock(path: string) {
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, String(process.pid))
  try {
    linkSync(temp, path)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    rmSync(temp, { force: true })
  }
  const pid = readPid(path)
  if (pid === undefined) return tryLock(path)
  if (pid === null) {
    // Пустой или испорченный замок — от старой версии или сбоя диска. Свежий считаем занятым
    let age = 0
    try {
      age = Date.now() - statSync(path).mtimeMs
    } catch {}
    if (age < EMPTY_LOCK_GRACE_MS) throw new DbLockedError(null, path)
  } else if (pid !== process.pid && isAlive(pid)) {
    throw new DbLockedError(pid, path)
  }
  // Замок остался от процесса, которого уже нет: забираем его. Перед удалением сверяем pid ещё
  // раз — вдруг другой процесс уже забрал замок — и берём через ту же попытку с link
  if (readPid(path) === pid) rmSync(path, { force: true })
  tryLock(path)
}

/** Путь к файлу замка базы: рядом с её папкой */
const lockPath = (dataDir: string) => `${dataDir.replace(/[\\/]+$/, '')}.lock`

/**
 * Берёт замок базы. waitMs — сколько ждать живого владельца: tsx watch перезапускает API
 * быстрее, чем старый процесс успевает выйти. Возвращает функцию, которая отпускает замок
 */
export async function lockDb(dataDir: string, { waitMs = 0 } = {}) {
  const path = lockPath(dataDir)
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
      if (readPid(path) === process.pid) rmSync(path, { force: true })
    } catch {}
  }
}
