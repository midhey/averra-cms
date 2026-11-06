import { readSiteScript, type SiteScript } from '@averra/schema'
import { eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { sites } from '../../db/schema'

const columns = { scriptPublished: sites.scriptPublished, scriptDraft: sites.scriptDraft }

type Row = { scriptPublished: unknown; scriptDraft: unknown }

/** Скрипт на сайте. Пустой — своего JS на сайте нет */
export const publishedSiteScript = (row: Pick<Row, 'scriptPublished'>) =>
  readSiteScript(row.scriptPublished)

/** Черновик: пока его нет — такой же, как на сайте */
const draftSiteScript = (row: Row) => readSiteScript(row.scriptDraft ?? row.scriptPublished)

const same = (a: SiteScript, b: SiteScript) =>
  a.script === b.script && JSON.stringify(a.origins) === JSON.stringify(b.origins)

/** Скрипт сайта для экрана «Скрипт сайта»: черновик, что на сайте и есть ли разница */
export type SiteScriptState = { draft: SiteScript; published: SiteScript; unpublished: boolean }

const stateOf = (row: Row): SiteScriptState => {
  const draft = draftSiteScript(row)
  const published = publishedSiteScript(row)
  return { draft, published, unpublished: !same(draft, published) }
}

export function siteScriptRepo(db: Db) {
  return {
    async read(siteId: string): Promise<SiteScriptState | undefined> {
      const [row] = await db.select(columns).from(sites).where(eq(sites.id, siteId))
      return row && stateOf(row)
    },

    /** Черновик. Сайт не меняется. undefined — сайта нет */
    async saveDraft(siteId: string, draft: SiteScript): Promise<SiteScriptState | undefined> {
      const [row] = await db
        .update(sites)
        .set({ scriptDraft: draft })
        .where(eq(sites.id, siteId))
        .returning(columns)
      return row && stateOf(row)
    },

    /** Отменить черновик: он снова такой же, как на сайте */
    async discardDraft(siteId: string): Promise<SiteScriptState | undefined> {
      const [row] = await db
        .update(sites)
        .set({ scriptDraft: null })
        .where(eq(sites.id, siteId))
        .returning(columns)
      return row && stateOf(row)
    },

    /**
     * Публикация черновика, который видел человек: черновик пишет и токен MCP, и без сверки на сайт
     * ушёл бы непрочитанный код. Поменялся — changed, ничего не публикуется. Строка сайта
     * заблокирована до конца
     */
    publish(siteId: string, seen: SiteScript) {
      return db.transaction(async (tx) => {
        const [row] = await tx.select(columns).from(sites).where(eq(sites.id, siteId)).for('update')
        if (!row) return undefined
        const draft = draftSiteScript(row)
        if (!same(draft, seen)) return { changed: true as const, state: undefined }
        const [saved] = await tx
          .update(sites)
          .set({ scriptPublished: draft, scriptDraft: null })
          .where(eq(sites.id, siteId))
          .returning(columns)
        if (!saved) throw new Error('База не вернула сайт после публикации скрипта')
        return { changed: false as const, state: stateOf(saved) }
      })
    },
  }
}
