import {
  blocks as blockCatalog,
  type Header,
  type HeaderTargetBlock,
  type HeaderTargetPage,
  MAIN_PAGE_SLUG,
  overlayFits,
  sameHeader,
} from '@averra/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { media, pages, sites } from '../../db/schema'
import type { Issue } from '../../errors'
import type { Tx } from '../../mail/outbox'
import { draftHeader, publishedHeader } from './read'

const columns = { headerPublished: sites.headerPublished, headerDraft: sites.headerDraft }

/**
 * Шапка для экрана «Шапка и подвал»: черновик, что на сайте (null — шапку ещё не публиковали) и
 * есть ли разница
 */
export type HeaderState = { draft: Header; published: Header | null; unpublished: boolean }

const stateOf = (row: { headerPublished: unknown; headerDraft: unknown }): HeaderState => {
  const draft = draftHeader(row)
  const published = publishedHeader(row)
  return { draft, published, unpublished: !published || !sameHeader(draft, published) }
}

const typeTitles = new Map<string, string>(blockCatalog.map((block) => [block.type, block.title]))

type StoredBlock = { id?: unknown; type?: unknown; props?: unknown }
type StoredContent = { blocks?: StoredBlock[]; hideHeader?: unknown; hideFooter?: unknown } | null

/** Заголовок блока, если он есть: «Наши цены» понятнее, чем #pricing-1 */
function blockLabel(block: StoredBlock) {
  const props = block.props as { title?: unknown } | undefined
  const title = typeof props?.title === 'string' ? props.title.trim() : ''
  return title === '' ? null : title
}

/** Блоки страницы для выбора цели: сначала черновик в его порядке, потом то, что только на сайте */
function targetBlocks(draft: StoredContent, published: StoredContent): HeaderTargetBlock[] {
  const onSite = new Set((published?.blocks ?? []).map((block) => String(block.id)))
  const inDraft = new Set((draft?.blocks ?? []).map((block) => String(block.id)))
  const seen = new Set<string>()
  return [...(draft?.blocks ?? []), ...(published?.blocks ?? [])].flatMap((block) => {
    const id = String(block.id)
    if (seen.has(id)) return []
    seen.add(id)
    const type = String(block.type)
    return [
      {
        id,
        type,
        label: blockLabel(block) ?? typeTitles.get(type) ?? null,
        draft: inDraft.has(id),
        published: onSite.has(id),
      },
    ]
  })
}

/** Страницы сайта с блоками черновика и сайта — в транзакции или без */
async function targetsOf(db: Db | Tx, siteId: string): Promise<HeaderTargetPage[]> {
  const rows = await db
    .select({
      slug: pages.slug,
      title: pages.title,
      draft: pages.draft,
      published: pages.published,
    })
    .from(pages)
    .where(eq(pages.siteId, siteId))
    .orderBy(sql`${pages.slug} <> ${MAIN_PAGE_SLUG}`, asc(pages.slug))
  return rows.map((row) => {
    const published = row.published as StoredContent
    return {
      slug: row.slug,
      title: row.title,
      published: published !== null,
      hideHeader: published?.hideHeader === true,
      hideFooter: published?.hideFooter === true,
      overlay: overlayFits(
        (published?.blocks ?? []).map((block) => ({
          type: String(block.type),
          props: block.props,
        })),
      ),
      blocks: targetBlocks(row.draft as StoredContent, published),
    }
  })
}

async function logoIssuesOf(db: Db | Tx, siteId: string, header: Header): Promise<Issue[]> {
  if (!header.logo) return []
  const [found] = await db
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.siteId, siteId), eq(media.id, header.logo)))
  return found ? [] : [{ path: 'logo', message: 'Картинки нет в медиатеке сайта: выберите другую' }]
}

export function headerRepo(db: Db) {
  return {
    async read(siteId: string): Promise<HeaderState | undefined> {
      const [row] = await db.select(columns).from(sites).where(eq(sites.id, siteId))
      return row && stateOf(row)
    },

    /**
     * Страницы сайта с блоками — цели меню и кнопки: что можно выбрать и что из этого на сайте.
     * Главная первой, остальные по адресу, как в списке страниц
     */
    targets: (siteId: string) => targetsOf(db, siteId),

    /** Логотип — картинка медиатеки этого сайта (SVG можно): чужую или удалённую не поставить */
    logoIssues: (siteId: string, header: Header) => logoIssuesOf(db, siteId, header),

    /** Черновик шапки. Сайт на сервере не меняется. undefined — сайта нет */
    async saveDraft(siteId: string, header: Header): Promise<HeaderState | undefined> {
      const [row] = await db
        .update(sites)
        .set({ headerDraft: header })
        .where(eq(sites.id, siteId))
        .returning(columns)
      return row && stateOf(row)
    },

    /**
     * Публикация черновика: он становится шапкой сайта. Перед ней — логотип ещё в медиатеке и
     * check: ведут ли пункты меню на опубликованное. Замечания возвращаются как есть,
     * ничего не меняя. Строка сайта заблокирована до конца: черновик не поменяется между чтением и
     * записью
     */
    publish(siteId: string, check: (draft: Header, targets: HeaderTargetPage[]) => Issue[]) {
      return db.transaction(async (tx) => {
        const [row] = await tx.select(columns).from(sites).where(eq(sites.id, siteId)).for('update')
        if (!row) return undefined
        const draft = draftHeader(row)
        const problem = [
          ...(await logoIssuesOf(tx, siteId, draft)),
          ...check(draft, await targetsOf(tx, siteId)),
        ]
        if (problem.length > 0) return { problem, state: undefined }
        const [saved] = await tx
          .update(sites)
          .set({ headerPublished: draft, headerDraft: null })
          .where(eq(sites.id, siteId))
          .returning(columns)
        if (!saved) throw new Error('База не вернула сайт после публикации шапки')
        return { problem: undefined, state: stateOf(saved) }
      })
    },

    /**
     * Убрать шапку с сайта: на страницах её больше нет, а настройки остаются черновиком — их можно
     * опубликовать снова. undefined — сайта нет
     */
    unpublish(siteId: string) {
      return db.transaction(async (tx) => {
        const [row] = await tx.select(columns).from(sites).where(eq(sites.id, siteId)).for('update')
        if (!row) return undefined
        const [saved] = await tx
          .update(sites)
          .set({ headerPublished: null, headerDraft: draftHeader(row) })
          .where(eq(sites.id, siteId))
          .returning(columns)
        if (!saved) throw new Error('База не вернула сайт после того, как шапку убрали')
        return { wasOnSite: row.headerPublished !== null, state: stateOf(saved) }
      })
    },
  }
}
