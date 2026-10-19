import { useQuery } from '@tanstack/react-query'
import { buildQuery } from '../queries'
import { isBuildActive } from './build-format'

/** Как часто спрашивать состояние, пока сборка ждёт или идёт */
const POLL_MS = 2000

/**
 * Сборка сайта на сервере. Данные грузит маршрут (второстепенное, allSettled): сбой
 * показывает тот, кто спросил, а не экран ошибки. Пока сборка ждёт или идёт — опрос
 */
export function useBuild(siteId: string) {
  return useQuery({
    ...buildQuery(siteId),
    retryOnMount: false,
    refetchInterval: (query) =>
      isBuildActive(query.state.data?.latest?.status ?? undefined) ? POLL_MS : false,
  })
}
