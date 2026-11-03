import { DRAFTS_ONLY, type TokenRights, type TokenRightsPatch } from '@averra/schema'
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

/** Права токена из строки api_tokens */
const rightsOf = (row: { blocksDraft: boolean; canPublish: boolean; canDelete: boolean }) =>
  ({
    blocksDraft: row.blocksDraft,
    publish: row.canPublish,
    delete: row.canDelete,
  }) satisfies TokenRights

/** Права в колонки api_tokens: только названные */
const columnsOf = (rights: TokenRightsPatch) => ({
  ...(rights.blocksDraft === undefined ? {} : { blocksDraft: rights.blocksDraft }),
  ...(rights.publish === undefined ? {} : { canPublish: rights.publish }),
  ...(rights.delete === undefined ? {} : { canDelete: rights.delete }),
})

const rightsColumns = {
  blocksDraft: apiTokens.blocksDraft,
  canPublish: apiTokens.canPublish,
  canDelete: apiTokens.canDelete,
}

export function tokensRepo(db: Db) {
  return {
    /**
     * Новый токен. Сам токен возвращается один раз: в базе остаётся только его хеш. Права — все
     * три явно, по умолчанию «только черновики»: DEFAULT колонок — для вставок прежней версии API
     */
    async create({
      siteId,
      name,
      createdBy,
      rights = DRAFTS_ONLY,
    }: {
      siteId: string
      name: string
      createdBy?: string
      rights?: TokenRights
    }) {
      const id = crypto.randomUUID()
      const token = `cms_${id}_${randomSecret()}`
      const [row] = await db
        .insert(apiTokens)
        .values({
          id,
          siteId,
          name,
          createdBy,
          ...columnsOf(rights),
          tokenHash: await sha256(token),
        })
        .returning({ createdAt: apiTokens.createdAt })
      if (!row) throw new Error('Токен не записался')
      return { id, token, createdAt: row.createdAt }
    },

    /** Действующий токен → его id, сайт и права. Чужой формат, неизвестный или отозванный — undefined */
    async verify(token: string) {
      const id = TOKEN_FORMAT.exec(token)?.[1]
      if (!id) return undefined
      const [row] = await db
        .select({
          siteId: apiTokens.siteId,
          tokenHash: apiTokens.tokenHash,
          revokedAt: apiTokens.revokedAt,
          ...rightsColumns,
        })
        .from(apiTokens)
        .where(eq(apiTokens.id, id))
      if (!row || row.revokedAt) return undefined
      if (!constantTimeEqual(await sha256(token), row.tokenHash)) return undefined
      await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, id))
      return { id, siteId: row.siteId, rights: rightsOf(row) }
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

    /**
     * Поменять названные права, остальные остаются. Действует сразу: права читаются при каждом
     * запросе. undefined — такого токена нет; иначе — права после правки
     */
    async setRights(id: string, patch: TokenRightsPatch) {
      const [row] = await db
        .update(apiTokens)
        .set(columnsOf(patch))
        .where(eq(apiTokens.id, id))
        .returning(rightsColumns)
      return row && rightsOf(row)
    },

    /** Все токены без хешей: для экрана «Доступ для ИИ» и команды token:list */
    async list() {
      const rows = await db
        .select({
          id: apiTokens.id,
          name: apiTokens.name,
          siteId: apiTokens.siteId,
          siteName: sites.name,
          createdBy: users.email,
          createdByName: users.name,
          createdAt: apiTokens.createdAt,
          ...rightsColumns,
          lastUsedAt: apiTokens.lastUsedAt,
          revokedAt: apiTokens.revokedAt,
        })
        .from(apiTokens)
        .innerJoin(sites, eq(sites.id, apiTokens.siteId))
        .leftJoin(users, eq(users.id, apiTokens.createdBy))
        .orderBy(asc(apiTokens.createdAt))
      return rows.map(({ blocksDraft, canPublish, canDelete, ...row }) => ({
        ...row,
        rights: rightsOf({ blocksDraft, canPublish, canDelete }),
      }))
    },
  }
}
