import {
  type CustomBlockDraft,
  CustomBlockDraft as CustomBlockDraftSchema,
  customBlockType,
  type ImportResolution,
} from '@averra/schema'
import { and, asc, desc, eq, isNotNull, max, or, sql } from 'drizzle-orm'
import type { Actor } from '../../auth/access'
import type { Db } from '../../db/client'
import { customBlockRevisions, customBlocks, pages, users } from '../../db/schema'

/**
 * Определение из базы. Схема могла стать строже после обновления Averra — тогда null: такое
 * определение не попадёт на страницы, пока владелец не поправит и не опубликует его снова
 */
export function readDefinition(value: unknown, script?: string): CustomBlockDraft | null {
  // script — из своей колонки (у черновика и опубликованного); у версии из истории скрипт лежит в
  // самом JSON, тогда его не передают
  const stored =
    script === undefined || value === null || typeof value !== 'object'
      ? value
      : { ...value, script }
  const result = CustomBlockDraftSchema.safeParse(stored)
  return result.success ? result.data : null
}

type Row = typeof customBlocks.$inferSelect

/** Черновик блока: определение и скрипт из своей колонки */
export const draftOf = (row: Pick<Row, 'draft' | 'scriptDraft'>) =>
  readDefinition(row.draft, row.scriptDraft)

/** Опубликованное определение со скриптом. null — блок не публиковали или схема не подходит */
export const publishedOf = (row: Pick<Row, 'published' | 'scriptPublished'>) =>
  row.published ? readDefinition(row.published, row.scriptPublished) : null

/**
 * Определение для записи: JSON без скрипта (его прочитает и прежняя версия после отката — оно
 * строгое) и скрипт отдельно, в колонку script_draft. Так откат выводит блок без скрипта, а не
 * теряет его целиком
 */
export function storedParts(draft: CustomBlockDraft) {
  const { script, ...definition } = draft
  return { definition, script }
}

/** Версия в историю: скрипт — в JSON версии и только если он есть */
const revisionOf = (definition: Record<string, unknown>, script: string) =>
  script === '' ? definition : { ...definition, script }

/** Свой блок для админки: черновик, опубликованное, есть ли разница и время */
export type CustomBlockView = {
  key: string
  draft: CustomBlockDraft | null
  published: CustomBlockDraft | null
  unpublished: boolean
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

export const viewOf = (row: Row): CustomBlockView => {
  const draft = draftOf(row)
  const published = publishedOf(row)
  return {
    key: row.key,
    draft,
    published,
    unpublished:
      row.published === null ||
      JSON.stringify(row.draft) !== JSON.stringify(row.published) ||
      row.scriptDraft !== row.scriptPublished,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  }
}

/** Страница, на которой стоит свой блок: в черновике и/или на сайте */
export type CustomBlockUsage = { slug: string; title: string; draft: boolean; published: boolean }

export function customBlocksRepo(db: Db) {
  const blockIs = (siteId: string, key: string) =>
    and(eq(customBlocks.siteId, siteId), eq(customBlocks.key, key))

  // Блок стоит на странице — элемент blocks с типом custom:<ключ>
  const uses = (column: typeof pages.draft | typeof pages.published, key: string) =>
    sql<boolean>`coalesce(jsonb_path_exists(${column}, '$.blocks[*] ? (@.type == $type)', jsonb_build_object('type', ${customBlockType(key)}::text)), false)`

  return {
    /** Свои блоки сайта по ключу */
    list(siteId: string) {
      return db
        .select()
        .from(customBlocks)
        .where(eq(customBlocks.siteId, siteId))
        .orderBy(asc(customBlocks.key))
    },

    async find(siteId: string, key: string) {
      const [row] = await db.select().from(customBlocks).where(blockIs(siteId, key))
      return row
    },

    /** Опубликованные определения — для проверки страниц, снимка рендерера и MCP */
    async published(siteId: string) {
      const rows = await db
        .select({
          published: customBlocks.published,
          scriptPublished: customBlocks.scriptPublished,
        })
        .from(customBlocks)
        .where(and(eq(customBlocks.siteId, siteId), isNotNull(customBlocks.published)))
        .orderBy(asc(customBlocks.key))
      return rows.flatMap((row) => {
        const definition = publishedOf(row)
        return definition ? [definition] : []
      })
    },

    /** Новый блок — черновик. Ключ занят — undefined (уникальный индекс, без гонки) */
    async create(siteId: string, draft: CustomBlockDraft) {
      const { definition, script } = storedParts(draft)
      const [row] = await db
        .insert(customBlocks)
        .values({ siteId, key: draft.key, draft: definition, scriptDraft: script })
        .onConflictDoNothing({ target: [customBlocks.siteId, customBlocks.key] })
        .returning()
      return row
    },

    /** Черновик существующего блока. Опубликованное не меняется. Нет блока — undefined */
    async saveDraft(siteId: string, draft: CustomBlockDraft) {
      const { definition, script } = storedParts(draft)
      const [row] = await db
        .update(customBlocks)
        .set({ draft: definition, scriptDraft: script, updatedAt: new Date() })
        .where(blockIs(siteId, draft.key))
        .returning()
      return row
    },

    /**
     * Публикация проверенного черновика: он становится опубликованным, в историю пишется версия.
     * Проверку (ей нужны запросы к медиатеке) делает маршрут до транзакции — в PGlite одно
     * соединение, и запрос мимо транзакции ждал бы её конца. Поэтому здесь черновик сверяется с
     * проверенным: поменялся — changed, ничего не публикуется. Строка блока заблокирована до конца
     */
    publish(siteId: string, checked: CustomBlockDraft, actor: Actor) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(customBlocks)
          .where(blockIs(siteId, checked.key))
          .for('update')
        if (!row) return undefined
        if (JSON.stringify(draftOf(row)) !== JSON.stringify(checked)) {
          return { changed: true as const, row: undefined }
        }
        const publishedAt = new Date()
        const [saved] = await tx
          .update(customBlocks)
          .set({ published: row.draft, scriptPublished: row.scriptDraft, publishedAt })
          .where(eq(customBlocks.id, row.id))
          .returning()
        if (!saved) throw new Error('База не вернула свой блок после публикации')
        const [last] = await tx
          .select({ version: max(customBlockRevisions.version) })
          .from(customBlockRevisions)
          .where(eq(customBlockRevisions.blockId, row.id))
        await tx.insert(customBlockRevisions).values({
          siteId,
          blockId: row.id,
          version: (last?.version ?? 0) + 1,
          definition: revisionOf(row.draft, row.scriptDraft),
          publishedBy: actor.kind === 'user' ? actor.user.id : null,
          publishedAt,
        })
        return { changed: false as const, row: saved }
      })
    },

    /** Версии блока, новые сверху, без содержимого */
    async revisions(siteId: string, key: string) {
      const rows = await db
        .select({
          id: customBlockRevisions.id,
          version: customBlockRevisions.version,
          publishedAt: customBlockRevisions.publishedAt,
          author: users.name,
        })
        .from(customBlockRevisions)
        .innerJoin(customBlocks, eq(customBlocks.id, customBlockRevisions.blockId))
        .leftJoin(users, eq(users.id, customBlockRevisions.publishedBy))
        .where(blockIs(siteId, key))
        .orderBy(desc(customBlockRevisions.version))
        .limit(100)
      return rows.map((row) => ({ ...row, publishedAt: row.publishedAt.toISOString() }))
    },

    async revision(siteId: string, key: string, revisionId: string) {
      const [row] = await db
        .select({
          version: customBlockRevisions.version,
          definition: customBlockRevisions.definition,
        })
        .from(customBlockRevisions)
        .innerJoin(customBlocks, eq(customBlocks.id, customBlockRevisions.blockId))
        .where(and(blockIs(siteId, key), eq(customBlockRevisions.id, revisionId)))
      return row
    },

    /** Страницы сайта, на которых стоит блок, — в черновике или на сайте */
    usage(siteId: string, key: string): Promise<CustomBlockUsage[]> {
      const draft = uses(pages.draft, key)
      const published = uses(pages.published, key)
      return db
        .select({ slug: pages.slug, title: pages.title, draft, published })
        .from(pages)
        .where(and(eq(pages.siteId, siteId), or(draft, published)))
        .orderBy(asc(pages.slug))
    },

    /** Опубликованные страницы с этим блоком: их данные сверяют с новым определением */
    publishedPagesWith(siteId: string, key: string) {
      return db
        .select({ slug: pages.slug, title: pages.publishedTitle, content: pages.published })
        .from(pages)
        .where(and(eq(pages.siteId, siteId), uses(pages.published, key)))
        .orderBy(asc(pages.slug))
    },

    /**
     * Тексты определений (черновик и опубликованное) в нижнем регистре: медиатека по ним находит,
     * в каких своих блоках стоит картинка. Один запрос на все картинки сразу
     */
    async definitionTexts(siteId: string) {
      const rows = await db
        .select({
          key: customBlocks.key,
          draft: customBlocks.draft,
          published: customBlocks.published,
        })
        .from(customBlocks)
        .where(eq(customBlocks.siteId, siteId))
      return rows.map((row) => ({
        key: row.key,
        title: readDefinition(row.draft)?.title ?? row.key,
        // Опубликованное название и текст: людям без права на черновики показывается только оно
        publishedTitle: row.published ? (readDefinition(row.published)?.title ?? row.key) : null,
        publishedText: JSON.stringify(row.published ?? '').toLowerCase(),
        text: `${JSON.stringify(row.draft)} ${JSON.stringify(row.published ?? '')}`.toLowerCase(),
      }))
    },

    /** Свои блоки, в определении которых есть картинка (CSS или пример): её нельзя удалить */
    async usingMedia(siteId: string, mediaId: string) {
      const id = mediaId.toLowerCase()
      const rows = await db
        .select({
          key: customBlocks.key,
          draft: customBlocks.draft,
          published: customBlocks.published,
        })
        .from(customBlocks)
        .where(
          and(
            eq(customBlocks.siteId, siteId),
            or(
              sql`position(${id} in lower(${customBlocks.draft}::text)) > 0`,
              sql`position(${id} in lower(coalesce(${customBlocks.published}::text, ''))) > 0`,
            ),
          ),
        )
      return rows.map((row) => ({
        key: row.key,
        title: readDefinition(row.draft)?.title ?? row.key,
        publishedTitle: row.published ? (readDefinition(row.published)?.title ?? row.key) : null,
        inPublished: JSON.stringify(row.published ?? '')
          .toLowerCase()
          .includes(id),
      }))
    },

    /** false — такого блока нет */
    async delete(siteId: string, key: string) {
      const deleted = await db
        .delete(customBlocks)
        .where(blockIs(siteId, key))
        .returning({ id: customBlocks.id })
      return deleted.length > 0
    },

    /**
     * Загрузка из файла переноса одной транзакцией: новые ключи — новыми черновиками, занятые — по
     * решению (заменить черновик, переименовать, пропустить). Нерешённый конфликт — ничего не
     * меняется, ответ — список ключей
     */
    importBlocks(
      siteId: string,
      blocks: readonly CustomBlockDraft[],
      resolutions: Readonly<Record<string, ImportResolution>>,
    ) {
      return db.transaction(async (tx) => {
        const existing = new Set(
          (
            await tx
              .select({ key: customBlocks.key })
              .from(customBlocks)
              .where(eq(customBlocks.siteId, siteId))
              .for('update')
          ).map((row) => row.key),
        )
        // Сначала весь план, потом запись: конфликт посреди списка не оставит половину загрузки
        const taken = new Set(existing)
        const unresolved: string[] = []
        const plan = blocks.map((block) => {
          const resolution = existing.has(block.key) ? resolutions[block.key] : undefined
          if (existing.has(block.key) && resolution === undefined) unresolved.push(block.key)
          if (resolution === 'skip' || resolution === 'replace') {
            return { action: resolution, key: block.key, block }
          }
          const key = typeof resolution === 'object' ? resolution.rename : block.key
          // Новое имя тоже занято (или повторяется в файле) — это снова конфликт
          if (taken.has(key)) unresolved.push(block.key)
          taken.add(key)
          return { action: 'create' as const, key, block }
        })
        if (unresolved.length > 0) {
          return { unresolved: [...new Set(unresolved)], created: [], replaced: [], skipped: [] }
        }

        const result = {
          unresolved: [],
          created: [] as string[],
          replaced: [] as string[],
          skipped: [] as string[],
        }
        for (const { action, key, block } of plan) {
          if (action === 'skip') {
            result.skipped.push(key)
          } else if (action === 'replace') {
            const { definition, script } = storedParts(block)
            await tx
              .update(customBlocks)
              .set({ draft: definition, scriptDraft: script, updatedAt: new Date() })
              .where(blockIs(siteId, key))
            result.replaced.push(key)
          } else {
            const { definition, script } = storedParts({ ...block, key })
            await tx
              .insert(customBlocks)
              .values({ siteId, key, draft: definition, scriptDraft: script })
            result.created.push(key)
          }
        }
        return result
      })
    },
  }
}
