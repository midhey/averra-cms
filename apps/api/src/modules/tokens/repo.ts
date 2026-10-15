import { constantTimeEqual } from 'better-auth/crypto'
import { asc, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { apiTokens, sites, users } from '../../db/schema'
import { randomSecret, sha256 } from '../../secrets'

// Токен: cms_<id строки в api_tokens>_<секрет: 32 случайных байта в hex>.
// По id строка находится индексом, а секрет сверяется сравнением хешей за постоянное время:
// поиск по самому хешу в базе превратил бы сравнение секрета в поиск по индексу
const TOKEN_FORMAT =
  /^cms_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_[0-9a-f]{64}$/

export function tokensRepo(db: Db) {
  return {
    /** Новый токен. Сам токен возвращается один раз: в базе остаётся только его хеш */
    async create({
      siteId,
      name,
      createdBy,
    }: {
      siteId: string
      name: string
      createdBy?: string
    }) {
      const id = crypto.randomUUID()
      const token = `cms_${id}_${randomSecret()}`
      await db
        .insert(apiTokens)
        .values({ id, siteId, name, createdBy, tokenHash: await sha256(token) })
      return { id, token }
    },

    /** Действующий токен → его id и сайт. Чужой формат, неизвестный или отозванный — undefined */
    async verify(token: string) {
      const id = TOKEN_FORMAT.exec(token)?.[1]
      if (!id) return undefined
      const [row] = await db
        .select({
          siteId: apiTokens.siteId,
          tokenHash: apiTokens.tokenHash,
          revokedAt: apiTokens.revokedAt,
        })
        .from(apiTokens)
        .where(eq(apiTokens.id, id))
      if (!row || row.revokedAt) return undefined
      if (!constantTimeEqual(await sha256(token), row.tokenHash)) return undefined
      await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, id))
      return { id, siteId: row.siteId }
    },

    /** false — такого токена нет. Повторный отзыв не сдвигает время первого */
    async revoke(id: string) {
      const [row] = await db
        .select({ revokedAt: apiTokens.revokedAt })
        .from(apiTokens)
        .where(eq(apiTokens.id, id))
      if (!row) return false
      if (!row.revokedAt) {
        await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, id))
      }
      return true
    },

    /** Все токены без хешей: для команды token:list */
    list() {
      return db
        .select({
          id: apiTokens.id,
          name: apiTokens.name,
          siteId: apiTokens.siteId,
          siteName: sites.name,
          createdBy: users.email,
          createdAt: apiTokens.createdAt,
          lastUsedAt: apiTokens.lastUsedAt,
          revokedAt: apiTokens.revokedAt,
        })
        .from(apiTokens)
        .innerJoin(sites, eq(sites.id, apiTokens.siteId))
        .leftJoin(users, eq(users.id, apiTokens.createdBy))
        .orderBy(asc(apiTokens.createdAt))
    },
  }
}
