import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaStorage } from '../media/storage'
import { BuildFailure, type SiteBuild } from './queue'
import { copyReferencedMedia, pruneUnusedAssets } from './release-files'
import { releaseName, siteReleases } from './releases'
import type { Render } from './renderer'

export type StaticSiteBuilderOptions = {
  /** PUBLISH_DIR: в нём папка на каждый сайт */
  publishDir: string
  /** Сколько версий сайта хранить (текущая не удаляется) */
  keepReleases: number
  storage: MediaStorage
  /** Картинки опубликованных страниц сайта (sitesRepo.publishedMediaIds) */
  publishedMedia: (siteId: string) => Promise<ReadonlySet<string>>
  render: Render
  log?: (message: string) => void
  now?: () => Date
}

/**
 * Сборка сайта в новую папку релиза и атомарная подмена текущей (src/publish/releases.ts). Шаги:
 * Astro собирает статику во временную папку → в неё ложатся файлы картинок опубликованных страниц,
 * на которые ссылается HTML → убирается то, на что страницы не ссылаются → папка становится
 * релизом, ссылка current — на него → старые релизы чистятся. Сбой на любом шаге до подмены удаляет
 * временную папку: сайт остаётся на прежней версии
 */
export function staticSiteBuilder({
  publishDir,
  keepReleases,
  storage,
  publishedMedia,
  render,
  log = () => {},
  now = () => new Date(),
}: StaticSiteBuilderOptions): SiteBuild {
  return async (siteId, signal) => {
    const releases = siteReleases(join(publishDir, siteId))
    const name = releaseName(now())
    const tmpDir = await releases.prepare(name)
    let peakRssBytes: number | undefined
    try {
      ;({ peakRssBytes } = await render({ siteId, outDir: tmpDir, signal }))
      const previous = await releases.current()
      await copyReferencedMedia({
        outDir: tmpDir,
        siteId,
        storage,
        // Читаются после сборки: страницу переопубликовали во время неё — по новой версии
        // уже стоит в очереди следующая сборка
        mediaIds: await publishedMedia(siteId),
        previousDir: previous ? releases.pathOf(previous) : undefined,
      })
      await pruneUnusedAssets(tmpDir)
      await releases.publish(tmpDir, name)
    } catch (error) {
      await releases.discard(tmpDir)
      // Сборка прошла, а упал шаг после неё (картинки, подмена): память сборки всё равно в журнал
      if (error instanceof BuildFailure || peakRssBytes === undefined) throw error
      throw new BuildFailure(error instanceof Error ? error.message : String(error), peakRssBytes)
    }
    // Чистка после подмены: её сбой не делает сборку упавшей — новая версия уже на сайте
    try {
      await releases.prune(keepReleases)
    } catch (error) {
      log(`Сайт ${siteId}: не удалось удалить старые версии — ${(error as Error).message}`)
    }
    return { release: name, peakRssBytes }
  }
}

/**
 * Файл, по которому видно, что версия собрана нынешним форматом релиза: страница 404 в корне
 * появилась вместе с SEO (robots.txt, sitemap.xml, иконки). Версия без него собрана прежней
 * Averra — после обновления такой сайт собирается заново при старте API
 */
export const RELEASE_MARKER = '404.html'

/** Сайт надо собрать: версии на диске нет или она собрана до нынешнего формата релиза */
export async function releaseOutdated(publishDir: string, siteId: string) {
  const releases = siteReleases(join(publishDir, siteId))
  const current = await releases.current()
  if (current === undefined) return true
  try {
    await access(join(releases.pathOf(current), RELEASE_MARKER))
    return false
  } catch {
    return true
  }
}
