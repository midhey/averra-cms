import {
  collectMediaRefs,
  customBlockKeysOf,
  footerMediaIds,
  headerMediaIds,
  themeMediaIds,
  visibleBlocks,
} from '@averra/schema'
import type { Db } from '../../db/client'
import { customBlocksRepo, draftOf } from '../custom-blocks/repo'
import { cssMediaIds } from '../custom-blocks/service'
import { draftFooter } from '../footer/read'
import { draftHeader } from '../header/read'
import { mediaRepo } from '../media/repo'
import { readStoredSettings } from '../settings/read'
import { effectiveSiteUrl } from '../settings/repo'
import { sitesRepo } from '../sites/repo'
import { draftTheme } from '../theme/read'

/** Только содержимое сайта: без полных строк sites, пользователей, заявок и настроек интеграций. */
export async function draftSnapshot(db: Db, siteId: string, slug: string, siteUrl?: string) {
  const repo = sitesRepo(db)
  const site = await repo.find(siteId)
  const found = await repo.findPage(siteId, slug)
  if (!site || !found) return undefined
  const content = { ...found.draft, blocks: visibleBlocks(found.draft.blocks) }
  const header = draftHeader(site)
  const footer = draftFooter(site)
  const theme = draftTheme(site)
  const settings = readStoredSettings(site.settings)
  const keys = new Set([
    ...customBlockKeysOf(content),
    ...(header.custom ? [header.custom.key] : []),
    ...(footer.custom ? [footer.custom.key] : []),
  ])
  const definitions = (await customBlocksRepo(db).list(siteId)).flatMap((row) => {
    if (!keys.has(row.key)) return []
    const definition = draftOf(row)
    if (!definition) return []
    const { title, fields, template, css, placement } = definition
    return [{ key: row.key, title, fields, template, css, placement }]
  })
  const mediaIds = [
    ...collectMediaRefs(content).map((ref) => ref.mediaId),
    ...headerMediaIds(header),
    ...footerMediaIds(footer),
    ...themeMediaIds(theme),
    ...definitions.flatMap((definition) => cssMediaIds(definition.css)),
  ]
  // Для меню нужны лишь адреса и видимые id блоков, а не содержимое остальных страниц.
  const targets = await repo.listPages(siteId)
  const pages = await Promise.all(
    targets.map(async ({ slug }) => {
      const page = await repo.findPage(siteId, slug)
      return {
        slug,
        content: { blocks: visibleBlocks(page?.draft.blocks ?? []).map(({ id }) => ({ id })) },
      }
    }),
  )
  return {
    site: {
      name: site.name,
      theme,
      header,
      footer,
      organization: settings.organization,
      language: settings.language,
      policyPage: settings.cookies.policyPage,
      url: effectiveSiteUrl(settings, siteUrl),
    },
    page: { slug: found.slug, title: found.title, content },
    pages,
    customBlocks: Object.fromEntries(definitions.map((definition) => [definition.key, definition])),
    media: await mediaRepo(db).files(siteId, mediaIds),
  }
}
