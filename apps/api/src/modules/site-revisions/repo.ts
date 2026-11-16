import { and, desc, eq, lt, max, sql } from 'drizzle-orm'
import type { Actor } from '../../auth/access'
import type { Db } from '../../db/client'
import { siteRevisions, sites, users } from '../../db/schema'
import type { Tx } from '../../mail/outbox'

export type SiteRevisionEntity = typeof siteRevisions.$inferSelect.entity
export const SITE_REVISIONS_LIMIT = 50

/** Вызывается под блокировкой строки сайта: номер и снимок принадлежат одной публикации */
export async function recordSiteRevision(
  tx: Tx,
  siteId: string,
  entity: SiteRevisionEntity,
  content: Record<string, unknown>,
  actor: Actor,
) {
  const scope = and(eq(siteRevisions.siteId, siteId), eq(siteRevisions.entity, entity))
  const [last] = await tx
    .select({ version: max(siteRevisions.version) })
    .from(siteRevisions)
    .where(scope)
  const version = (last?.version ?? 0) + 1
  await tx.insert(siteRevisions).values({
    siteId,
    entity,
    version,
    content,
    publishedBy: actor.kind === 'user' ? actor.user.id : null,
    publishedAt: new Date(),
  })
  await tx
    .delete(siteRevisions)
    .where(and(scope, lt(siteRevisions.version, version - SITE_REVISIONS_LIMIT + 1)))
}

export function siteRevisionsRepo(db: Db, entity: SiteRevisionEntity) {
  const scope = (siteId: string) =>
    and(eq(siteRevisions.siteId, siteId), eq(siteRevisions.entity, entity))
  const published =
    entity === 'header'
      ? sites.headerPublished
      : entity === 'footer'
        ? sites.footerPublished
        : entity === 'script'
          ? sites.scriptPublished
          : sites.theme
  return {
    async list(siteId: string) {
      const rows = await db
        .select({
          id: siteRevisions.id,
          version: siteRevisions.version,
          publishedAt: siteRevisions.publishedAt,
          userName: users.name,
          onSite: sql<boolean>`${published} is not null`,
        })
        .from(siteRevisions)
        .innerJoin(sites, eq(sites.id, siteRevisions.siteId))
        .leftJoin(users, eq(users.id, siteRevisions.publishedBy))
        .where(scope(siteId))
        .orderBy(desc(siteRevisions.version))
        .limit(SITE_REVISIONS_LIMIT)
      return rows.map(({ userName, onSite, ...revision }, index) => ({
        ...revision,
        current: index === 0 && onSite,
        author: userName === null ? null : { kind: 'user' as const, name: userName },
      }))
    },
    async find(siteId: string, revisionId: string) {
      const [row] = await db
        .select()
        .from(siteRevisions)
        .where(and(scope(siteId), eq(siteRevisions.id, revisionId)))
      return row
    },
  }
}
