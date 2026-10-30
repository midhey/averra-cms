import {
  collectMediaRefs,
  headerMediaIds,
  legacyTheme,
  MAIN_PAGE_SLUG,
  newSiteSettings,
  type PageContent,
  SITE_NAME_MAX,
  type StoredSiteSettings,
  settingsMediaIds,
  type Theme,
} from '@averra/schema'
import { and, asc, count, eq, isNotNull, max, sql } from 'drizzle-orm'
import type { Actor } from '../../auth/access'
import type { Db } from '../../db/client'
import { pageRevisions, pages, siteMembers, sites } from '../../db/schema'
import { customBlocksRepo } from '../custom-blocks/repo'
import { cssMediaIds } from '../custom-blocks/service'
import { publishedHeader } from '../header/read'
import { readStoredSettings } from '../settings/read'

/**
 * Название сайта установки, когда SITE_NAME не задан: домен сайта (из SITE_URL), а без него —
 * «Мой сайт». Дальше название живёт в базе: SITE_NAME и SITE_URL его не меняют
 */
export function defaultSiteName(siteUrl: string | undefined) {
  // Название — до 80 символов (SiteName), а домен бывает длиннее
  return siteUrl ? new URL(siteUrl).hostname.slice(0, SITE_NAME_MAX) : 'Мой сайт'
}

export function sitesRepo(db: Db) {
  const pageIs = (siteId: string, slug: string) =>
    and(eq(pages.siteId, siteId), eq(pages.slug, slug))

  /**
   * Сайт установки: одна установка — один сайт. Если сайтов в базе несколько (старые базы
   * разработки), это созданный первым, при равном времени — с меньшим id. Правило, а не
   * признак в базе: почему — в документации, «Решения → Одна установка — один сайт».
   * undefined — сайтов нет (API создаёт сайт при старте, см. ensureInstallationSite)
   */
  async function installationSite() {
    const [site] = await db
      .select()
      .from(sites)
      .orderBy(asc(sites.createdAt), asc(sites.id))
      .limit(1)
    return site
  }

  /**
   * Сайт создаётся сразу с главной: пустой черновик под названием сайта, не опубликован.
   * Без главной у сайта нет корня, а её же запрещено удалять — пусть она будет всегда.
   * settings — настройки SEO; без них — по умолчанию (сайт открыт поисковикам)
   */
  function createSite(name: string, theme: Theme, settings: Partial<StoredSiteSettings> = {}) {
    return db.transaction(async (tx) => {
      const [site] = await tx
        .insert(sites)
        // Тема — сразу опубликованная, и её проекция в прежнем формате: её читает версия до
        // редактора тем, если установку откатят
        .values({ name, theme: legacyTheme(theme), themePublished: theme, settings })
        .returning({ id: sites.id, name: sites.name })
      if (!site) throw new Error('База не вернула созданный сайт')
      await tx
        .insert(pages)
        .values({ siteId: site.id, slug: MAIN_PAGE_SLUG, title: name, draft: { blocks: [] } })
      return site
    })
  }

  return {
    /** Сайты, которые видит пришедший: владелец — все, участник — свои, токен — один свой */
    list(actor: Actor) {
      const columns = { id: sites.id, name: sites.name }
      const order = asc(sites.createdAt)
      if (actor.kind === 'token') {
        return db.select(columns).from(sites).where(eq(sites.id, actor.siteId)).orderBy(order)
      }
      if (actor.user.role === 'owner') return db.select(columns).from(sites).orderBy(order)
      return db
        .select(columns)
        .from(sites)
        .innerJoin(siteMembers, eq(siteMembers.siteId, sites.id))
        .where(eq(siteMembers.userId, actor.user.id))
        .orderBy(order)
    },

    async find(siteId: string) {
      const [site] = await db.select().from(sites).where(eq(sites.id, siteId))
      return site
    },

    installationSite,

    /** Сколько сайтов в базе: больше одного бывает только в старых базах разработки */
    async count() {
      const [row] = await db.select({ n: count() }).from(sites)
      return row?.n ?? 0
    },

    /**
     * Сайт установки, а если в базе нет ни одного — создаёт его (с главной). Так сайт появляется
     * при первом запуске API, без отдельного шага установки. created — создан ли он сейчас.
     * Новый сайт скрыт от поисковиков: его делают на настоящем домене до запуска, и недоделанный
     * сайт не должен попасть в индекс. Открывают его в разделе «SEO» при запуске
     */
    async ensureInstallationSite(name: string, theme: Theme) {
      const existing = await installationSite()
      if (existing) return { site: existing, created: false }
      await createSite(name, theme, newSiteSettings())
      const site = await installationSite()
      if (!site) throw new Error('База не вернула созданный сайт')
      return { site, created: true }
    },

    createSite,

    /** Страницы для списка в админке: главная первой, остальные по адресу */
    listPages(siteId: string) {
      return db
        .select({
          slug: pages.slug,
          title: pages.title,
          updatedAt: pages.updatedAt,
          publishedAt: pages.publishedAt,
          // jsonb сравнивается по смыслу, а не по тексту: то же содержимое, сохранённое
          // ещё раз, изменением не считается
          hasUnpublishedChanges: sql<boolean>`(${pages.published} is null
            or ${pages.draft} is distinct from ${pages.published}
            or ${pages.title} is distinct from ${pages.publishedTitle})`,
        })
        .from(pages)
        .where(eq(pages.siteId, siteId))
        .orderBy(sql`${pages.slug} <> ${MAIN_PAGE_SLUG}`, asc(pages.slug))
    },

    async findPage(siteId: string, slug: string) {
      const [page] = await db.select().from(pages).where(pageIs(siteId, slug))
      return page
    },

    /**
     * Новая страница — только черновик. Если адрес занят, возвращает undefined.
     * Занятость проверяет уникальный индекс, а не отдельный запрос перед вставкой:
     * две одновременные попытки не дадут 500, вторая просто получит «занято»
     */
    async createPage(siteId: string, slug: string, title: string, content: PageContent) {
      const [page] = await db
        .insert(pages)
        .values({ siteId, slug, title, draft: content })
        .onConflictDoNothing({ target: [pages.siteId, pages.slug] })
        .returning()
      return page
    },

    /** Создаёт страницу или заменяет её черновик. Опубликованная версия не меняется */
    async saveDraft(siteId: string, slug: string, title: string, content: PageContent) {
      const [page] = await db
        .insert(pages)
        .values({ siteId, slug, title, draft: content })
        .onConflictDoUpdate({
          target: [pages.siteId, pages.slug],
          set: { title, draft: content, updatedAt: new Date() },
        })
        .returning()
      if (!page) throw new Error('База не вернула сохранённую страницу')
      return page
    },

    /** Меняет черновик только существующей страницы. Нет такой — undefined */
    async updateDraft(siteId: string, slug: string, title: string, content: PageContent) {
      const [page] = await db
        .update(pages)
        .set({ title, draft: content, updatedAt: new Date() })
        .where(pageIs(siteId, slug))
        .returning()
      return page
    },

    /**
     * Публикация — копия черновика и заголовка в опубликованную версию плюс запись в историю.
     * Одна транзакция: публикации без версии в истории (и наоборот) не бывает
     */
    publish(siteId: string, slug: string, actor: Actor) {
      return db.transaction(async (tx) => {
        const [page] = await tx
          .update(pages)
          .set({
            published: sql`${pages.draft}`,
            publishedTitle: sql`${pages.title}`,
            publishedAt: new Date(),
          })
          .where(pageIs(siteId, slug))
          .returning()
        if (!page) return undefined
        const { published, publishedTitle, publishedAt } = page
        if (!published || publishedTitle === null || !publishedAt) {
          throw new Error('База не вернула опубликованную версию страницы')
        }

        // Номер считаем после UPDATE: он держит блокировку строки страницы, и две
        // одновременные публикации одной страницы получат номера по очереди
        const [last] = await tx
          .select({ version: max(pageRevisions.version) })
          .from(pageRevisions)
          .where(eq(pageRevisions.pageId, page.id))
        await tx.insert(pageRevisions).values({
          siteId,
          pageId: page.id,
          version: (last?.version ?? 0) + 1,
          // Снимок — из того, что вернул UPDATE: в истории ровно то, что ушло на сайт
          title: publishedTitle,
          content: published,
          publishedBy: actor.kind === 'user' ? actor.user.id : null,
          publishedByToken: actor.kind === 'token' ? actor.tokenId : null,
          publishedAt,
        })
        return page
      })
    },

    /**
     * Удаляет страницу. undefined — такой страницы не было; wasPublished — была ли она на сайте
     * (тогда сайт на сервере надо пересобрать без неё)
     */
    async deletePage(siteId: string, slug: string) {
      const [deleted] = await db
        .delete(pages)
        .where(pageIs(siteId, slug))
        .returning({ wasPublished: sql<boolean>`${pages.published} is not null` })
      return deleted
    },

    /** Сайты, у которых есть опубликованные страницы: их сайт на сервере должен быть собран */
    async sitesWithPublishedPages() {
      const rows = await db
        .selectDistinct({ siteId: pages.siteId })
        .from(pages)
        .where(isNotNull(pages.published))
      return rows.map((row) => row.siteId)
    },

    async publishedPages(siteId: string) {
      const rows = await db
        .select({
          slug: pages.slug,
          title: pages.publishedTitle,
          content: pages.published,
          publishedAt: pages.publishedAt,
        })
        .from(pages)
        .where(and(eq(pages.siteId, siteId), isNotNull(pages.published)))
        .orderBy(asc(pages.slug))
      // published и published_title заполнены вместе — это держит CHECK в базе
      // (pages_published_with_title), так что фильтр только сужает типы и страниц не теряет.
      // Сравниваем с null, а не на истинность: пустой заголовок — тоже заголовок.
      // publishedAt — дата страницы в sitemap.xml (lastmod)
      return rows.flatMap(({ slug, title, content, publishedAt }) =>
        content !== null && title !== null ? [{ slug, title, content, publishedAt }] : [],
      )
    },

    /**
     * Картинки опубликованного сайта — id из полей-картинок блоков опубликованных страниц
     * (collectMediaRefs), картинки настроек (OG, логотип, иконка), логотип шапки и картинки из CSS
     * своих блоков, как в снимке для рендерера.
     * По ним сборка решает, какие файлы картинок класть в релиз
     */
    async publishedMediaIds(siteId: string) {
      const rows = await db
        .select({ content: pages.published })
        .from(pages)
        .where(and(eq(pages.siteId, siteId), isNotNull(pages.published)))
      const [site] = await db
        .select({ settings: sites.settings, headerPublished: sites.headerPublished })
        .from(sites)
        .where(eq(sites.id, siteId))
      return new Set([
        ...rows.flatMap(({ content }) =>
          content ? collectMediaRefs(content).map((ref) => ref.mediaId) : [],
        ),
        ...(site ? settingsMediaIds(readStoredSettings(site.settings)) : []),
        ...(site ? headerMediaIds(publishedHeader(site)) : []),
        // Картинки из CSS опубликованных своих блоков (url(media:…))
        ...(await customBlocksRepo(db).published(siteId)).flatMap((block) =>
          cssMediaIds(block.css),
        ),
      ])
    },
  }
}
