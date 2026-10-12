import { queryOptions } from '@tanstack/react-query'
import { api } from './api'
import { apiRequestError } from './errors'

// Ключи идут от общего к частному: сброс ['sites', id, 'pages'] после мутации
// заодно сбрасывает и каждую страницу этого сайта
export const queryKeys = {
  sites: ['sites'] as const,
  site: (siteId: string) => ['sites', siteId] as const,
  pages: (siteId: string) => ['sites', siteId, 'pages'] as const,
  page: (siteId: string, slug: string) => ['sites', siteId, 'pages', slug] as const,
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
