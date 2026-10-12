import { type QueryClient, queryOptions } from '@tanstack/react-query'
import { api } from './api'
import { apiRequestError } from './errors'

// Ключи идут от общего к частному: сброс ['sites', id, 'pages'] после мутации
// заодно сбрасывает и каждую страницу этого сайта
export const queryKeys = {
  me: ['me'] as const,
  sites: ['sites'] as const,
  site: (siteId: string) => ['sites', siteId] as const,
  pages: (siteId: string) => ['sites', siteId, 'pages'] as const,
  page: (siteId: string, slug: string) => ['sites', siteId, 'pages', slug] as const,
  revisions: (siteId: string, slug: string) =>
    ['sites', siteId, 'pages', slug, 'revisions'] as const,
  revision: (siteId: string, slug: string, revisionId: string) =>
    ['sites', siteId, 'pages', slug, 'revisions', revisionId] as const,
}

export const sitesQuery = () =>
  queryOptions({
    queryKey: queryKeys.sites,
    queryFn: async () => {
      const res = await api.sites.$get()
      if (!res.ok) throw await apiRequestError(res)
      return res.json()
    },
  })

export const siteQuery = (siteId: string) =>
  queryOptions({
    queryKey: queryKeys.site(siteId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

export const pagesQuery = (siteId: string) =>
  queryOptions({
    queryKey: queryKeys.pages(siteId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].pages.$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

export const pageQuery = (siteId: string, slug: string) =>
  queryOptions({
    queryKey: queryKeys.page(siteId, slug),
    queryFn: async () => {
      const res = await api.sites[':siteId'].pages[':slug'].$get({ param: { siteId, slug } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/** История публикаций страницы, новые сверху. Публикация сбрасывает её вместе со списком страниц */
export const revisionsQuery = (siteId: string, slug: string) =>
  queryOptions({
    queryKey: queryKeys.revisions(siteId, slug),
    queryFn: async () => {
      const res = await api.sites[':siteId'].pages[':slug'].revisions.$get({
        param: { siteId, slug },
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/** Версия с содержимым. Снимок в истории не меняется никогда, поэтому и не устаревает */
export const revisionQuery = (siteId: string, slug: string, revisionId: string) =>
  queryOptions({
    queryKey: queryKeys.revision(siteId, slug, revisionId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].pages[':slug'].revisions[':revisionId'].$get({
        param: { siteId, slug, revisionId },
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    staleTime: Number.POSITIVE_INFINITY,
  })

/**
 * Кто вошёл. null — сессии нет (ответ 401): это не ошибка, а повод показать вход.
 * Не устаревает сам: сбрасывается при входе, выходе и любом 401
 */
export const meQuery = () =>
  queryOptions({
    queryKey: queryKeys.me,
    queryFn: async () => {
      const res = await api.me.$get()
      if (res.status === 401) return null
      if (res.status !== 200) throw await apiRequestError(res)
      const me = await res.json()
      return me.kind === 'user' ? me.user : null
    },
    staleTime: Number.POSITIVE_INFINITY,
  })

/**
 * Сменился пользователь (вход или выход): всё, что загружено до этого, — уже не про него.
 * Запрос «кто вошёл» не удаляем, а обновляем на месте: шапка подписана на него, и удалённый
 * запрос она бы так и показывала (clear() оставил бы в шапке прошлого пользователя)
 */
export async function switchUser(queryClient: QueryClient, signedIn: boolean) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] })
  if (signedIn) await queryClient.resetQueries({ queryKey: queryKeys.me })
  else queryClient.setQueryData(queryKeys.me, null)
}
