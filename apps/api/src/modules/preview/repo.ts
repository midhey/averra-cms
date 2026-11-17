import { PreviewToken } from '@averra/schema'
import { constantTimeEqual } from 'better-auth/crypto'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { previewLinks } from '../../db/schema'
import { randomSecret, sha256 } from '../../secrets'

const view = {
  id: previewLinks.id,
  name: previewLinks.name,
  createdAt: previewLinks.createdAt,
  expiresAt: previewLinks.expiresAt,
}

export function previewLinksRepo(db: Db) {
  return {
    async create(siteId: string, name: string, days: 1 | 3 | 7) {
      const id = crypto.randomUUID()
      const token = `preview_${id}_${randomSecret()}`
      const [row] = await db
        .insert(previewLinks)
        .values({
          id,
          siteId,
          name,
          tokenHash: await sha256(token),
          expiresAt: new Date(Date.now() + days * 86_400_000),
        })
        .returning(view)
      if (!row) throw new Error('Ссылка не записалась')
      return { ...row, token }
    },
    list(siteId: string) {
      return db
        .select(view)
        .from(previewLinks)
        .where(
          and(
            eq(previewLinks.siteId, siteId),
            isNull(previewLinks.revokedAt),
            gt(previewLinks.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(previewLinks.createdAt))
    },
    async revoke(siteId: string, id: string) {
      const rows = await db
        .update(previewLinks)
        .set({ revokedAt: new Date() })
        .where(and(eq(previewLinks.siteId, siteId), eq(previewLinks.id, id)))
        .returning({ id: previewLinks.id })
      return rows.length > 0
    },
    async verify(token: string) {
      const id = PreviewToken.safeParse(token).success ? token.split('_')[1] : undefined
      if (!id) return undefined
      const [row] = await db.select().from(previewLinks).where(eq(previewLinks.id, id))
      if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return undefined
      if (!constantTimeEqual(await sha256(token), row.tokenHash)) return undefined
      return { siteId: row.siteId, expiresAt: row.expiresAt }
    },
  }
}
