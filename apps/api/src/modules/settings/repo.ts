import type { SiteSettings, SiteSettingsPatch, StoredSiteSettings } from '@averra/schema'
import { eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { sites } from '../../db/schema'
import { readStoredSettings } from './read'

/**
 * Адрес опубликованного сайта: свой из настроек или адрес установки (SITE_URL). Без него нет
 * canonical, og:url, og:image и адресов в sitemap.xml
 */
export const effectiveSiteUrl = (settings: { url: string }, installationUrl: string | undefined) =>
  settings.url || installationUrl || null

/** Настройки сайта целиком: название из sites.name, остальное — из sites.settings */
const view = (name: string, settings: StoredSiteSettings): SiteSettings => ({ name, ...settings })

export function settingsRepo(db: Db) {
  return {
    /** Настройки сайта или undefined, если сайта нет */
    async read(siteId: string) {
      const [site] = await db
        .select({ name: sites.name, settings: sites.settings })
        .from(sites)
        .where(eq(sites.id, siteId))
      return site && view(site.name, readStoredSettings(site.settings))
    },

    /**
     * Меняет присланные поля, остальные остаются. Строка сайта блокируется до записи: два
     * сохранения разных разделов одновременно не затрут друг друга
     */
    update(siteId: string, patch: SiteSettingsPatch) {
      return db.transaction(async (tx) => {
        const [site] = await tx
          .select({ name: sites.name, settings: sites.settings })
          .from(sites)
          .where(eq(sites.id, siteId))
          .for('update')
        if (!site) return undefined
        const { name = site.name, ...fields } = patch
        // Поверх того, что в базе, а не прочитанного: поле, которое эта версия не поняла (его
        // записала более новая, установку откатили), не затирается значением по умолчанию
        const stored = { ...site.settings, ...fields }
        await tx.update(sites).set({ name, settings: stored }).where(eq(sites.id, siteId))
        return view(name, readStoredSettings(stored))
      })
    },
  }
}
