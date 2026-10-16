import { readFile, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { BackupRun, type DiskSpace, UpdateRun } from '@averra/schema'
import type { z } from 'zod'
import type { HostStatus } from '../modules/status/service'

// Сведения с сервера для состояния установки (modules/status): файлы, которые пишет
// deploy/averra.sh в папку состояния (в контейнере API она только для чтения), и место на диске

/** Имена файлов состояния — те же, что в deploy/averra.sh */
export const STATE_FILES = {
  backupLast: 'backup-last.json',
  backupLastOk: 'backup-last-ok.json',
  updateLast: 'update-last.json',
} as const

type Read<T> = { value: T | null; unreadable: boolean }

/** Файл чужого процесса: нет — null, есть, но не по схеме или битый — «не читается», а не 500 */
async function readState<S extends z.ZodType>(path: string, schema: S): Promise<Read<z.output<S>>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { value: null, unreadable: false }
    return { value: null, unreadable: true }
  }
  try {
    const parsed = schema.safeParse(JSON.parse(text))
    return parsed.success
      ? { value: parsed.data, unreadable: false }
      : { value: null, unreadable: true }
  } catch {
    return { value: null, unreadable: true }
  }
}

export type DiskTarget = { label: string; path: string }

/**
 * Сведения с сервера. stateDir не задан (разработка) — бэкапов у установки нет. Диски —
 * по меткам; одна и та же файловая система под двумя метками показывается один раз
 */
export function hostStatus({
  stateDir,
  disks,
}: {
  stateDir?: string
  disks: readonly DiskTarget[]
}): HostStatus {
  return {
    async backup() {
      if (!stateDir) return { enabled: false, unreadable: false, last: null, lastOk: null }
      const [last, lastOk] = await Promise.all([
        readState(join(stateDir, STATE_FILES.backupLast), BackupRun),
        readState(join(stateDir, STATE_FILES.backupLastOk), BackupRun),
      ])
      return {
        enabled: true,
        unreadable: last.unreadable || lastOk.unreadable,
        last: last.value,
        lastOk: lastOk.value,
      }
    },

    async update() {
      if (!stateDir) return { last: null, unreadable: false }
      const read = await readState(join(stateDir, STATE_FILES.updateLast), UpdateRun)
      // Не читается (битый или записан более новым averra.sh) — не молчать: откат мог потеряться
      return { last: read.value, unreadable: read.unreadable }
    },

    async disk() {
      const result: DiskSpace[] = []
      const seen = new Set<string>()
      for (const { label, path } of disks) {
        try {
          const info = await statfs(path)
          // Та же файловая система — те же размеры: показываем её один раз, первой меткой
          const key = `${info.type}:${info.blocks}:${info.bsize}`
          if (seen.has(key)) continue
          seen.add(key)
          result.push({
            label,
            freeBytes: info.bavail * info.bsize,
            totalBytes: info.blocks * info.bsize,
          })
        } catch {
          // Папки нет (том не подключён) — диска в списке нет, остальное состояние показываем
        }
      }
      return result
    },
  }
}

/**
 * Какие диски показывать: медиатека и сайты (тома Docker на сервере) и папка состояния — она
 * в папке установки, рядом с бэкапами. Метки — словами, без путей
 */
export function diskTargets(config: {
  MEDIA_DIR: string
  PUBLISH_DIR?: string
  STATE_DIR?: string
}): DiskTarget[] {
  const targets: DiskTarget[] = [{ label: 'данные (медиатека и сайты)', path: config.MEDIA_DIR }]
  if (config.PUBLISH_DIR) targets.push({ label: 'собранные сайты', path: config.PUBLISH_DIR })
  if (config.STATE_DIR) targets.push({ label: 'папка установки и бэкапы', path: config.STATE_DIR })
  return targets
}
