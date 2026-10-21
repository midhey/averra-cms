import { collectMediaRefs } from '@averra/schema'
import type { Db } from '../../db/client'
import { mediaRepo } from '../media/repo'
import { sitesRepo } from './repo'

/**
 * Всё, что нужно рендереру для сборки сайта: тема и опубликованные страницы. Снимок открыт без
 * входа (auth/middleware.ts): опубликованное и так публично. undefined — сайта нет
 */
export async function siteSnapshot(db: Db, siteId: string) {
  const repo = sitesRepo(db)
  const found = await repo.find(siteId)
  if (!found) return undefined
  const pages = await repo.publishedPages(siteId)
  // Справочник картинок — только тех, что стоят на опубликованных страницах: рендереру
  // нужны их варианты, а остальная медиатека снаружи не видна
  const mediaIds = pages.flatMap((page) => collectMediaRefs(page.content).map((ref) => ref.mediaId))
  return {
    site: { id: found.id, name: found.name, theme: found.theme },
    pages,
    media: await mediaRepo(db).files(siteId, mediaIds),
  }
}
