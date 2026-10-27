import { type Footer, footerPublishIssues, sameFooter } from '@averra/schema'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { pages, sites } from '../../db/schema'
import type { Issue } from '../../errors'
import type { Tx } from '../../mail/outbox'
import { readStoredSettings } from '../settings/read'
import { draftFooter, publishedFooter } from './read'

const columns = { footerPublished: sites.footerPublished, footerDraft: sites.footerDraft }

/**
 * Подвал для экрана «Шапка и подвал»: черновик, что на сайте (null — подвал ещё не публиковали) и
 * есть ли разница
 */
export type FooterState = { draft: Footer; published: Footer | null; unpublished: boolean }

const stateOf = (row: { footerPublished: unknown; footerDraft: unknown }): FooterState => {
  const draft = draftFooter(row)
  const published = publishedFooter(row)
  return { draft, published, unpublished: !published || !sameFooter(draft, published) }
}

/**
 * Страница политики конфиденциальности из «Cookie и согласие» и опубликована ли она. Без неё
 * форме подвала нельзя на сайт: она собирает телефон
 */
export async function policyOf(db: Db | Tx, siteId: string) {
  const [site] = await db
    .select({ settings: sites.settings })
    .from(sites)
    .where(eq(sites.id, siteId))
  if (!site) return undefined
  const slug = readStoredSettings(site.settings).cookies.policyPage
  if (slug === '') return { slug, published: false }
  const [page] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.siteId, siteId), eq(pages.slug, slug), isNotNull(pages.published)))
  return { slug, published: page !== undefined }
}

export function footerRepo(db: Db) {
  return {
    async read(siteId: string): Promise<FooterState | undefined> {
      const [row] = await db.select(columns).from(sites).where(eq(sites.id, siteId))
      return row && stateOf(row)
    },

    /** Черновик подвала. Сайт на сервере не меняется. undefined — сайта нет */
    async saveDraft(siteId: string, footer: Footer): Promise<FooterState | undefined> {
      const [row] = await db
        .update(sites)
        .set({ footerDraft: footer })
        .where(eq(sites.id, siteId))
        .returning(columns)
      return row && stateOf(row)
    },

    /**
     * Публикация черновика: он становится подвалом сайта. Перед ней — проверка (большому подвалу
     * нужна опубликованная политика). Замечания возвращаются как есть, ничего не меняя. Строка
     * сайта заблокирована до конца: черновик не поменяется между чтением и записью
     */
    publish(siteId: string) {
      return db.transaction(async (tx) => {
        const [row] = await tx.select(columns).from(sites).where(eq(sites.id, siteId)).for('update')
        if (!row) return undefined
        const draft = draftFooter(row)
        const policy = await policyOf(tx, siteId)
        const problem: Issue[] = footerPublishIssues(draft, policy?.published === true)
        if (problem.length > 0) return { problem, state: undefined }
        const [saved] = await tx
          .update(sites)
          .set({ footerPublished: draft, footerDraft: null })
          .where(eq(sites.id, siteId))
          .returning(columns)
        if (!saved) throw new Error('База не вернула сайт после публикации подвала')
        return { problem: undefined, state: stateOf(saved) }
      })
    },

    /**
     * Убрать подвал с сайта: внизу страниц снова прежняя полоса с документами, настройки остаются
     * черновиком. undefined — сайта нет
     */
    unpublish(siteId: string) {
      return db.transaction(async (tx) => {
        const [row] = await tx.select(columns).from(sites).where(eq(sites.id, siteId)).for('update')
        if (!row) return undefined
        const [saved] = await tx
          .update(sites)
          .set({ footerPublished: null, footerDraft: draftFooter(row) })
          .where(eq(sites.id, siteId))
          .returning(columns)
        if (!saved) throw new Error('База не вернула сайт после того, как подвал убрали')
        return { wasOnSite: row.footerPublished !== null, state: stateOf(saved) }
      })
    },
  }
}
