import { type Footer, readFooter } from '@averra/schema'

// Поля, о которых уже сказали в лог: подвал читается на каждом снимке, а сообщение нужно одно
const reported = new Set<string>()

/**
 * Подвал из базы. Поле, которое эта версия не понимает (его записала более новая, а установку
 * откатили), читается значением по умолчанию — и один раз попадает в лог
 */
export function readStoredFooter(stored: unknown): Footer {
  return readFooter(stored, (field) => {
    if (reported.has(field)) return
    reported.add(field)
    console.warn(
      `Подвал сайта: поле «${field}» записано другой версией Averra и этой не понятно — ` +
        'до обновления действует значение по умолчанию, в базе поле не тронуто',
    )
  })
}

type StoredFooters = { footerPublished: unknown; footerDraft: unknown }

/** Подвал на сайте. null — его ещё не публиковали: на сайте прежняя полоса с документами */
export const publishedFooter = (site: Pick<StoredFooters, 'footerPublished'>) =>
  site.footerPublished ? readStoredFooter(site.footerPublished) : null

/** Черновик подвала: пока его нет — такой же, как на сайте, а без него — подвал по умолчанию */
export const draftFooter = (site: StoredFooters) =>
  readStoredFooter(site.footerDraft ?? site.footerPublished)
