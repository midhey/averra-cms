import { CMS_API_URL, CMS_SITE_ID } from 'astro:env/server'
import type { AppType } from '@cms/api'
import { hc } from 'hono/client'

const sites = hc<AppType>(CMS_API_URL).api.sites

/** Опубликованный сайт из API: тема и страницы. Без запущенного API сборка падает с понятной ошибкой */
export async function loadSnapshot() {
  // Без id не обойтись: снимок сайта открыт, а список сайтов — только после входа
  if (!CMS_SITE_ID) {
    throw new Error(
      'Не задан CMS_SITE_ID — какой сайт собирать. Скопируй apps/renderer/.env.example в .env ' +
        'и впиши id сайта: он виден в адресе админки /sites/<id>',
    )
  }
  const siteId = CMS_SITE_ID
  const res = await request(() => sites[':siteId'].snapshot.$get({ param: { siteId } }))
  if (res.status === 404) throw new Error(`В API нет сайта ${siteId} (CMS_SITE_ID)`)
  if (res.status !== 200) throw new Error(`API ответил ${res.status} на сайт ${siteId}`)
  return res.json()
}

async function request<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (cause) {
    throw new Error(`API не отвечает на ${CMS_API_URL}. Запусти его: pnpm dev`, { cause })
  }
}
