import { CMS_API_URL, CMS_LINKS, CMS_SITE_ID } from 'astro:env/server'
import type { AppType } from '@averra/api'
import { demoSiteId, type MediaMap } from '@averra/schema'
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
  return { ...snapshot, media: withSiteUrls(snapshot.media) }
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

/** Путь файла картинки в API: /api/media/<id картинки>/<файл> */
const API_MEDIA_PREFIX = '/api/media/'

/**
 * Адрес файла картинки на сайте. API отдаёт адреса от своего корня (/api/media/…), а страницу
 * открывают с другого адреса. В режиме api ссылка ведёт на сам API. В режиме relative (публикация
 * на сервере) — на /media/<id>/<файл> от корня сайта: эти файлы публикация кладёт в папку релиза
 * (apps/api/src/publish), и сайт целиком — статика без API
 */
export function siteMediaUrl(apiUrl: string, links: 'api' | 'relative' = CMS_LINKS) {
  if (links === 'api') return new URL(apiUrl, CMS_API_URL).href
  if (!apiUrl.startsWith(API_MEDIA_PREFIX)) {
    throw new Error(`Неожиданный адрес файла картинки: ${apiUrl}`)
  }
  return `/media/${apiUrl.slice(API_MEDIA_PREFIX.length)}`
}

function withSiteUrls(media: MediaMap): MediaMap {
  return Object.fromEntries(
    Object.entries(media).map(([id, file]) => [
      id,
      {
        ...file,
        variants: file.variants.map((variant) => ({ ...variant, url: siteMediaUrl(variant.url) })),
      },
    ]),
  )
}

/**
 * Куда формы страницы шлют заявки: открытый адрес приёма в API. Форма — обычная HTML-форма
 * method="post", JS на сайте для неё не нужен. В режиме api — на CMS_API_URL (тот же, откуда сайт
 * берёт картинки). В режиме relative — путь от корня сайта: Caddy домена сайта передаёт его в API,
 * и форма уходит на свой же источник
 */
export const formActionFor =
  (siteId: string, slug: string, links: 'api' | 'relative' = CMS_LINKS) =>
  (blockId: string) => {
    const path = `/api/forms/${encodeURIComponent(siteId)}/${encodeURIComponent(slug)}/${encodeURIComponent(blockId)}`
    return links === 'relative' ? path : new URL(path, CMS_API_URL).href
  }

async function request<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (cause) {
    throw new Error(`API не отвечает на ${CMS_API_URL}. Запусти его: pnpm dev`, { cause })
  }
}
