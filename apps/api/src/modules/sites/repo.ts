import { MAIN_PAGE_SLUG, type PageContent, type Theme } from '@cms/schema'
import { and, asc, eq, isNotNull, max, sql } from 'drizzle-orm'
import type { Actor } from '../../auth/access'
import type { Db } from '../../db/client'
import { pageRevisions, pages, siteMembers, sites } from '../../db/schema'

export function sitesRepo(db: Db) {
  const pageIs = (siteId: string, slug: string) =>
    and(eq(pages.siteId, siteId), eq(pages.slug, slug))

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

    /**
     * Сайт создаётся сразу с главной: пустой черновик под названием сайта, не опубликован.
     * Без главной у сайта нет корня, а её же запрещено удалять — пусть она будет всегда
     */
    createSite(name: string, theme: Theme) {
      return db.transaction(async (tx) => {
        const [site] = await tx
          .insert(sites)
          .values({ name, theme })
          .returning({ id: sites.id, name: sites.name, theme: sites.theme })
        if (!site) throw new Error('База не вернула созданный сайт')
        await tx
          .insert(pages)
          .values({ siteId: site.id, slug: MAIN_PAGE_SLUG, title: name, draft: { blocks: [] } })
        return site
      })
    },

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

    /** false — такой страницы не было */
    async deletePage(siteId: string, slug: string) {
      const deleted = await db
        .delete(pages)
        .where(pageIs(siteId, slug))
        .returning({ slug: pages.slug })
      return deleted.length > 0
    },

    async publishedPages(siteId: string) {
      const rows = await db
        .select({ slug: pages.slug, title: pages.publishedTitle, content: pages.published })
        .from(pages)
        .where(and(eq(pages.siteId, siteId), isNotNull(pages.published)))
        .orderBy(asc(pages.slug))
      // published и published_title заполнены вместе — это держит CHECK в базе
      // (pages_published_with_title), так что фильтр только сужает типы и страниц не теряет
      return rows.flatMap(({ slug, title, content }) =>
        content && title ? [{ slug, title, content }] : [],
      )
    },
  }
}
