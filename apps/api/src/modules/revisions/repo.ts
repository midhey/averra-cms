import { and, desc, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { apiTokens, pageRevisions, pages, users } from '../../db/schema'

/** Сколько версий отдаёт список. Дальше нужна постраничная выдача — появится, когда понадобится */
const REVISIONS_LIMIT = 100

/**
 * Кто опубликовал: имя человека или название токена. null — автора нет: публикация до
 * истории версий, демо-сайт или удалённый пользователь. Почту не отдаём: историю видит и клиент
 */
export type RevisionAuthor = { kind: 'user' | 'token'; name: string } | null

const authorOf = (row: { userName: string | null; tokenName: string | null }): RevisionAuthor => {
  if (row.userName !== null) return { kind: 'user', name: row.userName }
  if (row.tokenName !== null) return { kind: 'token', name: row.tokenName }
  return null
}

export function revisionsRepo(db: Db) {
  const summary = {
    id: pageRevisions.id,
    version: pageRevisions.version,
    title: pageRevisions.title,
    publishedAt: pageRevisions.publishedAt,
    userName: users.name,
    tokenName: apiTokens.name,
  }

  // Версии ищем через страницу по сайту и адресу: id версии другой страницы или чужого
  // сайта сюда не подойдёт, даже если его знать
  const pageIs = (siteId: string, slug: string) =>
    and(eq(pages.siteId, siteId), eq(pages.slug, slug))
  const page = eq(pages.id, pageRevisions.pageId)
  const user = eq(users.id, pageRevisions.publishedBy)
  const token = eq(apiTokens.id, pageRevisions.publishedByToken)

  return {
    /** Версии страницы, новые сверху. Без содержимого: список должен быть лёгким */
    async list(siteId: string, slug: string) {
      const rows = await db
        .select(summary)
        .from(pageRevisions)
        .innerJoin(pages, page)
        .leftJoin(users, user)
        .leftJoin(apiTokens, token)
        .where(pageIs(siteId, slug))
        .orderBy(desc(pageRevisions.version))
        .limit(REVISIONS_LIMIT)
      return rows.map(({ userName, tokenName, ...revision }) => ({
        ...revision,
        author: authorOf({ userName, tokenName }),
      }))
    },

    async find(siteId: string, slug: string, revisionId: string) {
      const [row] = await db
        .select({ ...summary, content: pageRevisions.content })
        .from(pageRevisions)
        .innerJoin(pages, page)
        .leftJoin(users, user)
        .leftJoin(apiTokens, token)
        .where(and(pageIs(siteId, slug), eq(pageRevisions.id, revisionId)))
      if (!row) return undefined
      const { userName, tokenName, ...revision } = row
      return { ...revision, author: authorOf({ userName, tokenName }) }
    },
  }
}
