import { CMS_API_URL, CMS_SITE_ID } from 'astro:env/server'
import type { AppType } from '@cms/api'
import { hc } from 'hono/client'

const sites = hc<AppType>(CMS_API_URL).api.sites

/** Опубликованный сайт из API: тема и страницы. Без запущенного API сборка падает с понятной ошибкой */
export async function loadSnapshot() {
  const siteId = CMS_SITE_ID ?? (await firstSiteId())
  const res = await request(() => sites[':siteId'].snapshot.$get({ param: { siteId } }))
  if (res.status !== 200) throw new Error(`API ответил ${res.status} на сайт ${siteId}`)
  return res.json()
}

async function firstSiteId() {
  const res = await request(() => sites.$get())
  const [site] = await res.json()
  if (!site) throw new Error('В базе нет ни одного сайта')
  return site.id
}

async function request<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (cause) {
    throw new Error(`API не отвечает на ${CMS_API_URL}. Запусти его: pnpm dev`, { cause })
  }
}
