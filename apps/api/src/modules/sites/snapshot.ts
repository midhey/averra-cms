import {
  collectMediaRefs,
  footerMediaIds,
  headerMediaIds,
  MAIN_PAGE_SLUG,
  Organization,
  settingsMediaIds,
  themeMediaIds,
} from '@averra/schema'
import type { Db } from '../../db/client'
import { customBlocksRepo } from '../custom-blocks/repo'
import { cssMediaIds } from '../custom-blocks/service'
import { publishedFooter } from '../footer/read'
import { publishedHeader } from '../header/read'
import { mediaRepo } from '../media/repo'
import { readStoredSettings } from '../settings/read'
import { effectiveSiteUrl } from '../settings/repo'
import { publishedSiteScript } from '../site-script/repo'
import { publishedTheme } from '../theme/read'
import { sitesRepo } from './repo'

/**
 * Всё, что нужно рендереру для сборки сайта: тема, настройки SEO, адрес сайта и опубликованные
 * страницы. Снимок открыт без входа (auth/middleware.ts): в нём только то, что и так попадает на
 * сайт. Коды проверки, счётчики и редиректы видны на любой опубликованной странице или по ответу
 * сервера. Организация (телефон, адрес, ИНН — у ИП это его личные данные) — только в разметке
 * главной, поэтому до публикации главной в снимке её нет. Шапка — опубликованная (null — её не
 * публиковали, на сайте шапки нет); телефон и адрес в неё рендерер берёт из той же организации.
 * Подвал — опубликованный (null — на сайте прежняя полоса с документами); реквизиты, контакты и
 * соцсети в него — тоже из организации. Свои блоки — опубликованные определения (шаблон, CSS и
 * скрипт и так на сайте в собранном виде). Скрипт сайта — опубликованный: код и домены для CSP
 * (их видно в заголовке ответа сайта).
 * siteUrl — адрес установки (SITE_URL),
 * если своего в настройках нет. undefined — сайта нет
 */
export async function siteSnapshot(db: Db, siteId: string, siteUrl: string | undefined) {
  const repo = sitesRepo(db)
  const found = await repo.find(siteId)
  if (!found) return undefined
  const pages = await repo.publishedPages(siteId)
  const stored = readStoredSettings(found.settings)
  const mainPublished = pages.some((page) => page.slug === MAIN_PAGE_SLUG)
  const settings = mainPublished ? stored : { ...stored, organization: Organization.parse({}) }
  // Справочник картинок — только тех, что стоят на опубликованных страницах и в настройках:
  // рендереру нужны их варианты, а остальная медиатека снаружи не видна
  const header = publishedHeader(found)
  const footer = publishedFooter(found)
  // Свои блоки — опубликованные определения: их шаблон и CSS рендерер собирает в страницы. Картинки
  // из их CSS (url(media:…)) — в справочник, как картинки блоков
  const customBlocks = await customBlocksRepo(db).published(siteId)
  const theme = publishedTheme(found)
  const mediaIds = [
    // Фон-картинка страницы из темы
    ...themeMediaIds(theme),
    ...customBlocks.flatMap((block) => cssMediaIds(block.css)),
    ...pages.flatMap((page) => collectMediaRefs(page.content).map((ref) => ref.mediaId)),
    ...settingsMediaIds(settings),
    ...headerMediaIds(header),
    // Картинки в полях своего вида подвала (у шапки — в headerMediaIds)
    ...footerMediaIds(footer),
  ]
  return {
    site: {
      id: found.id,
      name: found.name,
      theme,
      header,
      footer,
      script: publishedSiteScript(found),
      url: effectiveSiteUrl(settings, siteUrl),
      settings,
    },
    pages,
    customBlocks: Object.fromEntries(
      customBlocks.map(({ key, title, fields, template, css, script, placement }) => [
        key,
        { key, title, fields, template, css, script, placement },
      ]),
    ),
    media: await mediaRepo(db).files(siteId, mediaIds),
  }
}
