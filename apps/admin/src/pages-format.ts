import { MAIN_PAGE_SLUG } from '@averra/schema'
import { countRu } from './format/plural'
import type { StatusTone } from './ui/StatusPill'

type PageStatus = { publishedAt: string | null; hasUnpublishedChanges: boolean }

/** Что с публикацией страницы: словами для плашки и тоном. Смысл несёт текст, цвет — подсказка */
export function pageState({ publishedAt, hasUnpublishedChanges }: PageStatus): {
  label: string
  tone: StatusTone
} {
  if (publishedAt === null) return { label: 'Черновик', tone: 'neutral' }
  return hasUnpublishedChanges
    ? { label: 'Есть правки', tone: 'warning' }
    : { label: 'Опубликована', tone: 'success' }
}

/**
 * Что опубликует «Опубликовать правки»: страницы, у которых опубликованная версия отстаёт
 * от черновика. Никогда не публиковавшиеся черновики не трогаем — их выпускают из редактора
 */
export const pagesWithChanges = <Page extends PageStatus>(pages: readonly Page[]) =>
  pages.filter((page) => page.publishedAt !== null && page.hasUnpublishedChanges)

/** Поиск по списку страниц: по заголовку и адресу, без учёта регистра и «ё» */
export function filterPages<Page extends { title: string; slug: string }>(
  pages: readonly Page[],
  query: string,
) {
  const normalize = (text: string) => text.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim()
  const needle = normalize(query)
  if (needle === '') return [...pages]
  return pages.filter(
    (page) =>
      normalize(page.title).includes(needle) || normalize(pagePath(page.slug)).includes(needle),
  )
}

/** Сводка под числом страниц: «3 опубликованы, 1 черновик» */
export function pagesSummary(pages: readonly PageStatus[]) {
  const published = pages.filter((page) => page.publishedAt !== null).length
  const drafts = pages.length - published
  const parts = [
    published > 0 && countRu(published, ['опубликована', 'опубликованы', 'опубликовано']),
    drafts > 0 && countRu(drafts, ['черновик', 'черновика', 'черновиков']),
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'Страниц нет'
}

/** Адрес страницы на сайте: главная открывается по корню */
export const pagePath = (slug: string) => (slug === MAIN_PAGE_SLUG ? '/' : `/${slug}`)

/** Дата и время по-русски. Часовой пояс задаётся только в тестах, в админке — пояс браузера */
export function formatDateTime(iso: string, timeZone?: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso))
}
