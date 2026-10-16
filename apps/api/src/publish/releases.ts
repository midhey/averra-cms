import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readlink, rename, rm, symlink, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'

// Папки версий сайта на диске (модуль 9):
//
//   <PUBLISH_DIR>/<id сайта>/releases/<имя релиза>/   — собранные версии, по папке на сборку
//   <PUBLISH_DIR>/<id сайта>/current → releases/<имя> — ссылка на текущую, её отдаёт Caddy
//
// Сборка пишет во временную папку (.tmp-<имя>), готовая переименовывается в releases/<имя>,
// и только потом подменяется ссылка current. Подмена — rename новой ссылки поверх старой:
// на Linux это атомарно, Caddy в любой момент видит либо старую версию целиком, либо новую.
// Сборка упала — временная папка удаляется, current не трогали

/** Имя ещё не готовой папки сборки. Такие папки — мусор после сбоя, их убирает prune */
const TMP_PREFIX = '.tmp-'

/** Имя релиза: время сборки (сортируется как строка) и случайный хвост против совпадений */
export function releaseName(now: Date) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
  return `${stamp}-${randomBytes(3).toString('hex')}`
}

/** Только наши имена: время и хвост. Чужие папки в releases prune не трогает */
const RELEASE_NAME = /^\d{8}T\d{6}Z-[0-9a-f]{6}$/

export function siteReleases(siteDir: string) {
  const releasesDir = join(siteDir, 'releases')
  const currentLink = join(siteDir, 'current')

  /** Имя текущего релиза или undefined, если сайт ещё ни разу не собран */
  async function current() {
    try {
      // На Windows ссылка — junction с абсолютным путём: имя релиза — последняя часть пути
      return basename(await readlink(currentLink))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  /**
   * Делает релиз name текущим. Новая ссылка создаётся рядом под временным именем и
   * переименовывается поверх current: rename заменяет ссылку атомарно (Linux, прод).
   * Windows (разработка, тесты) не умеет переименовать папку-ссылку поверх существующей —
   * там старая ссылка сначала удаляется, и на миг сайта нет. На сервере этого кода не бывает
   */
  async function activate(name: string) {
    const tmpLink = join(siteDir, `.current-${randomBytes(4).toString('hex')}`)
    // Цель относительная: Caddy видит ту же папку под другим путём (свой том в контейнере).
    // 'junction' действует только на Windows (там Node делает путь абсолютным), на Linux — symlink
    await symlink(join('releases', name), tmpLink, 'junction')
    try {
      await rename(tmpLink, currentLink)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EEXIST' && code !== 'EISDIR') {
        await unlink(tmpLink).catch(() => {})
        throw error
      }
      await unlink(currentLink)
      await rename(tmpLink, currentLink)
    }
  }

  return {
    siteDir,
    releasesDir,
    currentLink,
    current,

    /** Путь папки релиза по имени */
    pathOf: (name: string) => join(releasesDir, name),

    /** Временная папка новой сборки — пустая */
    async prepare(name: string) {
      const dir = join(releasesDir, `${TMP_PREFIX}${name}`)
      await rm(dir, { recursive: true, force: true })
      await mkdir(dir, { recursive: true })
      return dir
    },

    /** Готовая сборка: временная папка становится релизом name, а он — текущим */
    async publish(tmpDir: string, name: string) {
      await rename(tmpDir, join(releasesDir, name))
      await activate(name)
    },

    /** Сборка не удалась: временная папка удаляется, текущая версия не тронута */
    discard: (tmpDir: string) => rm(tmpDir, { recursive: true, force: true }),

    /**
     * Оставляет keep последних релизов (по имени, оно начинается со времени) и всегда текущий,
     * остальные и брошенные временные папки удаляет. Зовётся после подмены, внутри очереди
     * сборок: чужой сборки в этот момент идти не может, поэтому любая .tmp- — мусор
     */
    async prune(keep: number) {
      const active = await current()
      let entries: string[]
      try {
        entries = await readdir(releasesDir)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
      const releases = entries.filter((entry) => RELEASE_NAME.test(entry)).sort()
      const kept = new Set(releases.slice(-keep))
      if (active) kept.add(active)
      const removed = [
        ...releases.filter((name) => !kept.has(name)),
        ...entries.filter((entry) => entry.startsWith(TMP_PREFIX)),
      ]
      for (const name of removed)
        await rm(join(releasesDir, name), { recursive: true, force: true })
      return removed
    },
  }
}

export type SiteReleases = ReturnType<typeof siteReleases>
