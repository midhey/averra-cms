import {
  type AnalyticsIds,
  cookieNoticeShown,
  legalPages,
  MAIN_PAGE_SLUG,
  NOT_FOUND_PAGE_SLUG,
} from '@averra/schema'

// Модель экрана «Cookie и согласие»: какие страницы можно выбрать политикой, что сказать про
// выбранную и какие шаблоны документов ещё можно создать. Без React — её проверяют тесты

export type PageListItem = { slug: string; title: string; publishedAt: string | null }

const pathOf = (slug: string) => (slug === MAIN_PAGE_SLUG ? '/' : `/${slug}`)

/**
 * Счётчики для предпросмотра и подсказки текста. На сайте их нет — образец с Метрикой: видно, как
 * уведомление встанет и что скажет, когда счётчик добавят, а подсказка совпадает с предпросмотром
 */
export const previewAnalytics = (analytics: AnalyticsIds): AnalyticsIds =>
  cookieNoticeShown(analytics) ? analytics : { metrika: '1', ga4: '' }

/** Варианты выбора страницы политики: «нет» и страницы сайта, кроме 404 */
export function policyOptions(pages: readonly PageListItem[], current: string) {
  const options = [{ value: '', label: 'Не выбрана' }]
  for (const page of pages) {
    if (page.slug === NOT_FOUND_PAGE_SLUG) continue
    options.push({ value: page.slug, label: `${page.title} — ${pathOf(page.slug)}` })
  }
  // Выбранная страница удалена — она всё равно в списке, иначе select молча показал бы «нет»
  if (current !== '' && !pages.some((page) => page.slug === current)) {
    options.push({ value: current, label: `${pathOf(current)} — страницы нет` })
  }
  return options
}

/** Что не так со страницей политики: на сайте ссылки на неё не будет. undefined — всё хорошо */
export function policyProblem(pages: readonly PageListItem[], slug: string) {
  if (slug === '') {
    return 'Страница политики не выбрана: в уведомлении и внизу страниц не будет ссылки на неё. Политику требует 152-ФЗ, если сайт собирает данные — создайте её из шаблона.'
  }
  const page = pages.find((candidate) => candidate.slug === slug)
  if (!page)
    return `Страницы ${pathOf(slug)} на сайте нет: выберите другую или создайте из шаблона.`
  if (page.publishedAt === null) {
    return `Страница «${page.title}» ещё не опубликована: пока на сайте нет ссылки на неё. Проверьте текст и опубликуйте её.`
  }
  return undefined
}

/** Страница документа уже есть: тогда вместо «Создать из шаблона» — «Открыть в редакторе» */
export function legalPageOf(pages: readonly PageListItem[], document: keyof typeof legalPages) {
  return pages.find((page) => page.slug === legalPages[document].slug)
}
