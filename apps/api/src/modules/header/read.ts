import { type Header, readHeader } from '@averra/schema'

// Поля, о которых уже сказали в лог: шапка читается на каждом снимке, а сообщение нужно одно
const reported = new Set<string>()

/**
 * Шапка из базы. Поле, которое эта версия не понимает (его записала более новая, а установку
 * откатили), читается значением по умолчанию — и один раз попадает в лог
 */
export function readStoredHeader(stored: unknown): Header {
  return readHeader(stored, (field) => {
    if (reported.has(field)) return
    reported.add(field)
    console.warn(
      `Шапка сайта: поле «${field}» записано другой версией Averra и этой не понятно — ` +
        'до обновления действует значение по умолчанию, в базе поле не тронуто',
    )
  })
}

type StoredHeaders = { headerPublished: unknown; headerDraft: unknown }

/** Шапка на сайте. null — её ещё не публиковали: на сайте шапки нет */
export const publishedHeader = (site: Pick<StoredHeaders, 'headerPublished'>) =>
  site.headerPublished ? readStoredHeader(site.headerPublished) : null

/** Черновик шапки: пока его нет — такой же, как на сайте, а без неё — шапка по умолчанию */
export const draftHeader = (site: StoredHeaders) =>
  readStoredHeader(site.headerDraft ?? site.headerPublished)
