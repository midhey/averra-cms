import { useSuspenseQuery } from '@tanstack/react-query'
import { currentSiteQuery } from './queries'

/**
 * Сайт установки: id, название, адрес. Его заранее загружает загрузчик маршрута (router.tsx),
 * поэтому экран получает его сразу, без своего ожидания
 */
export function useCurrentSite() {
  return useSuspenseQuery(currentSiteQuery()).data
}

/** Id сайта установки: в адресах экранов его нет, а запросам в API он нужен */
export const useSiteId = () => useCurrentSite().id
