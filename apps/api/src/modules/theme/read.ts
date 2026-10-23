import { readTheme, type Theme } from '@averra/schema'

// Поля, о которых уже сказали в лог: тема читается на каждом снимке и каждой карточке для
// соцсетей, а сообщение нужно одно
const reported = new Set<string>()

/**
 * Тема из базы. Поле, которое эта версия не понимает (его записала более новая, а установку
 * откатили), читается значением по умолчанию — и один раз попадает в лог
 */
export function readStoredTheme(stored: unknown): Theme {
  return readTheme(stored, (field) => {
    if (reported.has(field)) return
    reported.add(field)
    console.warn(
      `Тема сайта: поле «${field}» записано другой версией Averra и этой не понятно — ` +
        'до обновления действует значение по умолчанию, в базе поле не тронуто',
    )
  })
}

type StoredThemes = { theme: unknown; themePublished: unknown; themeDraft: unknown }

/** Тема на сайте. Сайт до редактора тем — тема из прежней колонки theme */
export const publishedTheme = (site: Omit<StoredThemes, 'themeDraft'>) =>
  readStoredTheme(site.themePublished ?? site.theme)

/** Черновик темы: пока его нет, он такой же, как тема на сайте */
export const draftTheme = (site: StoredThemes) =>
  site.themeDraft ? readStoredTheme(site.themeDraft) : publishedTheme(site)
