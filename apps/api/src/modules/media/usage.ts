import { footerMediaIds, headerMediaIds, MAIN_PAGE_SLUG, type SiteSettings } from '@averra/schema'
import { eq } from 'drizzle-orm'
import { type Actor, can, type SiteRole } from '../../auth/access'
import type { Db } from '../../db/client'
import { pages } from '../../db/schema'
import { customBlocksRepo } from '../custom-blocks/repo'
import { footerRepo } from '../footer/repo'
import { headerRepo } from '../header/repo'
import { settingsRepo } from '../settings/repo'

/** Где используется картинка: для карточки медиатеки и для отказа удалить */
export type MediaUse =
  | { kind: 'page'; slug: string; title: string; state: 'draft' | 'published' | 'both' }
  | { kind: 'header' }
  | { kind: 'seo'; roles: string[] }
  | { kind: 'block'; key: string; title: string }

/** Где в настройках SEO стоит картинка — словами для сообщения */
export function settingsMediaRoles(settings: SiteSettings, mediaId: string) {
  return [
    settings.icon === mediaId && 'иконка сайта',
    settings.ogImage === mediaId && 'картинка для соцсетей',
    settings.organization.logo === mediaId && 'логотип организации',
  ].filter((role): role is string => role !== false)
}

/** Все mediaId в JSON блоков страницы — где угодно в полях, в нижнем регистре */
function mediaIdsIn(value: unknown, found = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) mediaIdsIn(item, found)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'mediaId' && typeof item === 'string') found.add(item.toLowerCase())
      else mediaIdsIn(item, found)
    }
  }
  return found
}

/**
 * Черновики своих блоков людям и токенам открыты не все (blocks.draft): без этого права место в
 * блоке называется только по опубликованному определению, а то, что есть лишь в черновике, — одной
 * безымянной строкой, чтобы название и ключ неопубликованной работы не утекали через медиатеку
 */
export const HIDDEN_BLOCK_KEY = ''
export const HIDDEN_BLOCK_TITLE = 'неопубликованный блок'

/**
 * Где стоит каждая из картинок: страницы (черновик и сайт), логотип шапки, настройки SEO, свои
 * блоки (CSS или пример). Один проход по данным сайта на все картинки — медиатека показывает это
 * на каждой карточке, и запрос на картинку вышел бы десятками запросов. Страницы — по порядку
 * адреса, главная первой
 */
export async function mediaUsage(
  db: Db,
  siteId: string,
  ids: readonly string[],
  seesBlockDrafts: boolean,
) {
  const usage = new Map<string, MediaUse[]>(ids.map((id) => [id, []]))
  if (ids.length === 0) return usage
  const add = (id: string, use: MediaUse) => usage.get(id)?.push(use)

  const rows = await db
    .select({
      slug: pages.slug,
      title: pages.title,
      draft: pages.draft,
      published: pages.published,
    })
    .from(pages)
    .where(eq(pages.siteId, siteId))
  rows.sort(
    (a, b) =>
      Number(b.slug === MAIN_PAGE_SLUG) - Number(a.slug === MAIN_PAGE_SLUG) ||
      a.slug.localeCompare(b.slug),
  )
  for (const page of rows) {
    const inDraft = mediaIdsIn(page.draft)
    const onSite = mediaIdsIn(page.published)
    for (const id of ids) {
      const key = id.toLowerCase()
      const draft = inDraft.has(key)
      const published = onSite.has(key)
      if (draft || published) {
        add(id, {
          kind: 'page',
          slug: page.slug,
          title: page.title,
          state: draft && published ? 'both' : draft ? 'draft' : 'published',
        })
      }
    }
  }

  // Логотип шапки и картинки в полях своих видов шапки и подвала — экран «Шапка и подвал»
  const header = await headerRepo(db).read(siteId)
  const footer = await footerRepo(db).read(siteId)
  const chrome = new Set([
    ...headerMediaIds(header?.draft),
    ...headerMediaIds(header?.published),
    ...footerMediaIds(footer?.draft),
    ...footerMediaIds(footer?.published),
  ])
  for (const id of ids) {
    if (chrome.has(id)) add(id, { kind: 'header' })
  }

  const settings = await settingsRepo(db).read(siteId)
  if (settings) {
    for (const id of ids) {
      const roles = settingsMediaRoles(settings, id)
      if (roles.length > 0) add(id, { kind: 'seo', roles })
    }
  }

  const blocks = await customBlocksRepo(db).definitionTexts(siteId)
  for (const id of ids) {
    const key = id.toLowerCase()
    let hidden = false
    for (const block of blocks) {
      if (seesBlockDrafts) {
        if (block.text.includes(key)) add(id, { kind: 'block', key: block.key, title: block.title })
      } else if (block.publishedTitle !== null && block.publishedText.includes(key)) {
        add(id, { kind: 'block', key: block.key, title: block.publishedTitle })
      } else if (block.text.includes(key)) {
        hidden = true
      }
    }
    if (hidden) add(id, { kind: 'block', key: HIDDEN_BLOCK_KEY, title: HIDDEN_BLOCK_TITLE })
  }
  return usage
}

/** Видит ли тот, кто спрашивает, черновики своих блоков: как `GET /custom-blocks` */
export function seesBlockDrafts(actor: Actor, siteRole: SiteRole) {
  return actor.kind === 'user' ? can(siteRole, 'blocks.define') : actor.rights.blocksDraft
}
