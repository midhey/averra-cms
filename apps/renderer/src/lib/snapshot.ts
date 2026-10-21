import { CMS_API_URL, CMS_LINKS, CMS_SITE_ID } from 'astro:env/server'
import type { AppType } from '@averra/api'
import type { MediaMap } from '@averra/schema'
import { hc } from 'hono/client'

const api = hc<AppType>(CMS_API_URL).api

/**
 * Опубликованный сайт из API: тема и страницы. Какой сайт — CMS_SITE_ID (его ставит API сборщику
 * публикации), а без него — сайт установки: одна установка — один сайт, и id искать не нужно.
 * Без запущенного API сборка падает с понятной ошибкой
 */
export async function loadSnapshot() {
  const res = await request(() =>
    CMS_SITE_ID
      ? api.sites[':siteId'].snapshot.$get({ param: { siteId: CMS_SITE_ID } })
      : api.site.snapshot.$get(),
  )
  if (res.status === 404) {
    throw new Error(
      CMS_SITE_ID
        ? `В API нет сайта ${CMS_SITE_ID} (CMS_SITE_ID)`
        : 'В API ещё нет сайта: его создаёт API при первом запуске (pnpm dev)',
    )
  }
  if (res.status !== 200) throw new Error(`API ответил ${res.status} на снимок сайта`)
  const snapshot = await res.json()
  return { ...snapshot, media: withSiteUrls(snapshot.media) }
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
