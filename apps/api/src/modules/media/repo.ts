import type { ImageMimeType } from '@cms/schema'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { Actor } from '../../auth/access'
import type { Db } from '../../db/client'
import { apiTokens, media, pages, type StoredVariant, users } from '../../db/schema'

/** Адрес файла варианта. Относительный: админка ходит через свой прокси, рендерер добавит хост */
export const mediaFileUrl = (mediaId: string, file: string) => `/api/media/${mediaId}/${file}`

const withUrls = (mediaId: string, variants: StoredVariant[]) =>
  variants.map(({ format, width, height, size, file }) => ({
    format,
    width,
    height,
    size,
    url: mediaFileUrl(mediaId, file),
  }))

/** Кто загрузил: имя человека или название токена. Почту не отдаём — медиатеку видит и клиент */
export type MediaAuthor = { kind: 'user' | 'token'; name: string } | null

export type NewMedia = {
  id: string
  siteId: string
  originalName: string
  mimeType: ImageMimeType
  width: number
  height: number
  size: number
  variants: StoredVariant[]
  originalFile: string
}

/** Где используется картинка: адрес и заголовок страницы, в черновике и/или на сайте */
export type MediaUsage = { slug: string; title: string; draft: boolean; published: boolean }

export function mediaRepo(db: Db) {
  const listColumns = {
    id: media.id,
    originalName: media.originalName,
    mimeType: media.mimeType,
    width: media.width,
    height: media.height,
    size: media.size,
    variants: media.variants,
    createdAt: media.createdAt,
    userName: users.name,
    tokenName: apiTokens.name,
  }

  type Row = {
    id: string
    variants: StoredVariant[]
    userName: string | null
    tokenName: string | null
  }
  const view = <T extends Row>({ userName, tokenName, variants, ...row }: T) => {
    const author: MediaAuthor =
      userName !== null
        ? { kind: 'user', name: userName }
        : tokenName !== null
          ? { kind: 'token', name: tokenName }
          : null
    return { ...row, author, variants: withUrls(row.id, variants) }
  }

  // Ссылка на картинку в JSON страницы — это поле mediaId где угодно в блоках. Сравниваем без
  // учёта регистра: схема приводит id к строчным, но промах здесь означал бы удаление картинки,
  // которая стоит на странице, поэтому не полагаемся на то, как id записан в JSON
  const mentions = (column: typeof pages.draft | typeof pages.published, mediaId: string) =>
    sql<boolean>`exists (select 1 from jsonb_path_query(${column}, '$.**.mediaId') as ref where lower(ref #>> '{}') = lower(${mediaId}::text))`

  async function find(siteId: string, mediaId: string) {
    const [row] = await db
      .select(listColumns)
      .from(media)
      .leftJoin(users, eq(users.id, media.uploadedBy))
      .leftJoin(apiTokens, eq(apiTokens.id, media.uploadedByToken))
      .where(and(eq(media.siteId, siteId), eq(media.id, mediaId)))
    return row && view(row)
  }

  return {
    /** Медиатека сайта, новые сверху */
    async list(siteId: string) {
      const rows = await db
        .select(listColumns)
        .from(media)
        .leftJoin(users, eq(users.id, media.uploadedBy))
        .leftJoin(apiTokens, eq(apiTokens.id, media.uploadedByToken))
        .where(eq(media.siteId, siteId))
        .orderBy(desc(media.createdAt), desc(media.id))
      return rows.map(view)
    },

    find,

    /**
     * Запись для отдачи файла и удаления: id, сайт, варианты и оригинал. Ключи файлов строим
     * из id, которые вернула база, а не из запроса
     */
    async findFiles(mediaId: string) {
      const [row] = await db
        .select({
          id: media.id,
          siteId: media.siteId,
          variants: media.variants,
          originalFile: media.originalFile,
        })
        .from(media)
        .where(eq(media.id, mediaId))
      return row
    },

    async create(values: NewMedia, actor: Actor) {
      await db.insert(media).values({
        ...values,
        uploadedBy: actor.kind === 'user' ? actor.user.id : null,
        uploadedByToken: actor.kind === 'token' ? actor.tokenId : null,
      })
      const created = await find(values.siteId, values.id)
      if (!created) throw new Error('База не вернула загруженную картинку')
      return created
    },

    /** Какие из этих id есть в медиатеке сайта. Чужие и несуществующие не попадут */
    async existingIds(siteId: string, ids: readonly string[]) {
      if (ids.length === 0) return new Set<string>()
      const rows = await db
        .select({ id: media.id })
        .from(media)
        .where(and(eq(media.siteId, siteId), inArray(media.id, [...new Set(ids)])))
      return new Set(rows.map((row) => row.id))
    },

    /** Справочник для блоков: id → размеры и варианты. Только картинки этого сайта */
    async files(siteId: string, ids: readonly string[]) {
      if (ids.length === 0) return {}
      const rows = await db
        .select({
          id: media.id,
          width: media.width,
          height: media.height,
          variants: media.variants,
        })
        .from(media)
        .where(and(eq(media.siteId, siteId), inArray(media.id, [...new Set(ids)])))
      return Object.fromEntries(
        rows.map(({ id, width, height, variants }) => [
          id,
          {
            width,
            height,
            variants: withUrls(id, variants).map(({ size: _, ...variant }) => variant),
          },
        ]),
      )
    },

    /** Страницы сайта, в черновике или опубликованной версии которых есть картинка */
    usage(siteId: string, mediaId: string): Promise<MediaUsage[]> {
      const draft = mentions(pages.draft, mediaId)
      const published = mentions(pages.published, mediaId)
      return db
        .select({ slug: pages.slug, title: pages.title, draft, published })
        .from(pages)
        .where(and(eq(pages.siteId, siteId), or(draft, published)))
        .orderBy(pages.slug)
    },

    /** false — такой картинки у сайта нет */
    async delete(siteId: string, mediaId: string) {
      const deleted = await db
        .delete(media)
        .where(and(eq(media.siteId, siteId), eq(media.id, mediaId)))
        .returning({ id: media.id })
      return deleted.length > 0
    },
  }
}
