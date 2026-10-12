import { CMS_API_URL, CMS_SITE_ID } from 'astro:env/server'
import type { AppType } from '@cms/api'
import { demoSiteId, type MediaMap } from '@cms/schema'
import { hc } from 'hono/client'

const sites = hc<AppType>(CMS_API_URL).api.sites

/** Опубликованный сайт из API: тема и страницы. Без запущенного API сборка падает с понятной ошибкой */
export async function loadSnapshot() {
  const siteId = resolveSiteId()
  const res = await request(() => sites[':siteId'].snapshot.$get({ param: { siteId } }))
  if (res.status === 404) {
    throw new Error(
      CMS_SITE_ID
        ? `В API нет сайта ${siteId} (CMS_SITE_ID)`
        : `В API нет демо-сайта ${siteId}. ${setSiteIdHint}`,
    )
  }
  if (res.status !== 200) throw new Error(`API ответил ${res.status} на сайт ${siteId}`)
  const snapshot = await res.json()
  return { ...snapshot, media: withAbsoluteUrls(snapshot.media) }
}

const setSiteIdHint =
  'Скопируй apps/renderer/.env.example в .env и впиши CMS_SITE_ID: id сайта виден в адресе ' +
  'админки /sites/<id>'

let warnedAboutDemo = false

/**
 * Какой сайт собирать. Без id не обойтись: снимок сайта открыт, а список сайтов — только после
 * входа. В pnpm dev без CMS_SITE_ID берём демо-сайт: у свежей базы его id известен заранее,
 * и рендерер работает сразу после клонирования. Сборка же должна явно знать, что собирает
 */
function resolveSiteId() {
  if (CMS_SITE_ID) return CMS_SITE_ID
  if (!import.meta.env.DEV)
    throw new Error(`Не задан CMS_SITE_ID — какой сайт собирать. ${setSiteIdHint}`)
  if (!warnedAboutDemo) {
    warnedAboutDemo = true
    console.warn(`CMS_SITE_ID не задан: в dev показываю демо-сайт ${demoSiteId}. ${setSiteIdHint}`)
  }
  return demoSiteId
}

/**
 * API отдаёт адреса файлов картинок от своего корня (/api/media/…), а страницу сайта открывают
 * с другого адреса — ссылки должны вести на сам API. Когда публикация начнёт выкладывать
 * файлы вместе со статикой (модуль 9), адреса будут указывать туда
 */
function withAbsoluteUrls(media: MediaMap): MediaMap {
  return Object.fromEntries(
    Object.entries(media).map(([id, file]) => [
      id,
      {
        ...file,
        variants: file.variants.map((variant) => ({
          ...variant,
          url: new URL(variant.url, CMS_API_URL).href,
        })),
      },
    ]),
  )
}

async function request<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (cause) {
    throw new Error(`API не отвечает на ${CMS_API_URL}. Запусти его: pnpm dev`, { cause })
  }
}
