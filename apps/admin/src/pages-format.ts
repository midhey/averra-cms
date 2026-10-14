import { MAIN_PAGE_SLUG } from '@averra/schema'

type PageStatus = { publishedAt: string | null; hasUnpublishedChanges: boolean }

/** Что с публикацией страницы, словами для списка */
export function pageState({ publishedAt, hasUnpublishedChanges }: PageStatus) {
  if (publishedAt === null) return 'Не опубликована'
  return hasUnpublishedChanges ? 'Есть неопубликованные изменения' : 'Опубликована'
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
