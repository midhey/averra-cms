import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { PublishedSite, SiteFile } from '../modules/export/routes'
import { siteReleases } from './releases'

/**
 * Текущая версия сайта на диске для выгрузки архивом: файлы папки релиза, на которую смотрит
 * current. Берём папку по имени релиза, а не через ссылку current: публикация во время выгрузки
 * переключит ссылку, а архив должен остаться одной версией. Ссылки внутри релиза не идём —
 * сборка их не делает (картинки — жёсткие ссылки, это обычные файлы)
 */
export function publishedSite(publishDir: string): PublishedSite {
  return {
    async current(siteId) {
      const releases = siteReleases(join(publishDir, siteId))
      const release = await releases.current()
      if (!release) return undefined
      const root = releases.pathOf(release)
      const entries = await readdir(root, { recursive: true, withFileTypes: true })
      const files: SiteFile[] = []
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const path = join(entry.parentPath, entry.name)
        const info = await stat(path)
        files.push({
          path: relative(root, path).split(sep).join('/'),
          size: info.size,
          mtime: info.mtime,
          read: () => createReadStream(path),
        })
      }
      files.sort((a, b) => a.path.localeCompare(b.path))
      return { release, files }
    },
  }
}
