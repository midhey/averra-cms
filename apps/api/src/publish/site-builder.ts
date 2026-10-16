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
  render: Render
  log?: (message: string) => void
  now?: () => Date
}

/**
 * Сборка сайта в новую папку релиза и атомарная подмена текущей (src/publish/releases.ts).
 * Шаги: Astro собирает статику во временную папку → в неё ложатся файлы картинок, на которые
 * ссылаются страницы → убирается то, на что страницы не ссылаются → папка становится релизом,
 * ссылка current — на него → старые релизы чистятся. Сбой на любом шаге до подмены удаляет
 * временную папку: сайт остаётся на прежней версии
 */
export function staticSiteBuilder({
  publishDir,
  keepReleases,
  storage,
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

/** Есть ли у сайта собранная текущая версия на диске */
export const hasCurrentRelease = async (publishDir: string, siteId: string) =>
  (await siteReleases(join(publishDir, siteId)).current()) !== undefined
