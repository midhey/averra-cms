import { legacyTheme, sameTheme, type Theme } from '@averra/schema'
import { eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { sites } from '../../db/schema'
import type { Issue } from '../../errors'
import { draftTheme, publishedTheme } from './read'

const columns = {
  theme: sites.theme,
  themePublished: sites.themePublished,
  themeDraft: sites.themeDraft,
}

/** Тема для экрана «Тема»: черновик, опубликованная и есть ли между ними разница */
export type ThemeView = { draft: Theme; published: Theme; unpublished: boolean }

const viewOf = (row: { theme: unknown; themePublished: unknown; themeDraft: unknown }) => {
  const draft = draftTheme(row)
  const published = publishedTheme(row)
  return { draft, published, unpublished: !sameTheme(draft, published) } satisfies ThemeView
}

export function themeRepo(db: Db) {
  return {
    async read(siteId: string): Promise<ThemeView | undefined> {
      const [row] = await db.select(columns).from(sites).where(eq(sites.id, siteId))
      return row && viewOf(row)
    },

    /** Черновик темы. Сайт на сервере не меняется. undefined — сайта нет */
    async saveDraft(siteId: string, theme: Theme): Promise<ThemeView | undefined> {
      const [row] = await db
        .update(sites)
        .set({ themeDraft: theme })
        .where(eq(sites.id, siteId))
        .returning(columns)
      return row && viewOf(row)
    },

    /**
     * Публикация черновика: он становится темой сайта, а прежняя колонка theme получает его
     * проекцию в старом формате — её прочтёт версия до редактора тем после отката. check —
     * последняя проверка черновика перед публикацией (контраст): её результат возвращается как
     * есть, ничего не меняя. Строка сайта заблокирована до конца: черновик не поменяется между
     * чтением и записью
     */
    publish(siteId: string, check: (draft: Theme) => Issue[] | undefined) {
      return db.transaction(async (tx) => {
        const [row] = await tx.select(columns).from(sites).where(eq(sites.id, siteId)).for('update')
        if (!row) return undefined
        const draft = draftTheme(row)
        const problem = check(draft)
        if (problem) return { problem, view: undefined }
        const [saved] = await tx
          .update(sites)
          .set({ themePublished: draft, themeDraft: null, theme: legacyTheme(draft) })
          .where(eq(sites.id, siteId))
          .returning(columns)
        if (!saved) throw new Error('База не вернула сайт после публикации темы')
        return { problem: undefined, view: viewOf(saved) }
      })
    },
  }
}
