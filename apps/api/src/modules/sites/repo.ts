import type { PageContent } from '@cms/schema'
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { pages, sites } from '../../db/schema'

export function sitesRepo(db: Db) {
  const pageIs = (siteId: string, slug: string) =>
    and(eq(pages.siteId, siteId), eq(pages.slug, slug))

  return {
    list() {
      return db.select({ id: sites.id, name: sites.name }).from(sites).orderBy(asc(sites.createdAt))
    },

    async find(siteId: string) {
      const [site] = await db.select().from(sites).where(eq(sites.id, siteId))
      return site
    },

    async findPage(siteId: string, slug: string) {
      const [page] = await db.select().from(pages).where(pageIs(siteId, slug))
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

    /** Публикация — копия черновика и заголовка в опубликованную версию */
    async publish(siteId: string, slug: string) {
      const [page] = await db
        .update(pages)
        .set({
          published: sql`${pages.draft}`,
          publishedTitle: sql`${pages.title}`,
          publishedAt: new Date(),
        })
        .where(pageIs(siteId, slug))
        .returning()
      return page
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
