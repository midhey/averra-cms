import { z } from 'zod'

// Ролики YouTube, Rutube и VK Видео: ссылку, которую вставил человек, строго разбираем в id ролика.
// Из id, а не из присланной строки, потом строятся и ссылка «Смотреть на …», и адрес плеера:
// на страницу не попадёт ни чужой домен, ни лишний параметр

export const videoProviders = ['youtube', 'rutube', 'vk'] as const
export type VideoProvider = (typeof videoProviders)[number]

/** Название площадки для людей: «Смотреть на YouTube» */
export const videoProviderTitles: Record<VideoProvider, string> = {
  youtube: 'YouTube',
  rutube: 'Rutube',
  vk: 'VK Видео',
}

export type VideoRef =
  | { provider: 'youtube'; id: string }
  /** privateKey — ключ закрытого ролика (?p=): без него закрытый ролик не откроется */
  | { provider: 'rutube'; id: string; privateKey?: string }
  /**
   * hash — из кода вставки VK: у части роликов плеер без него не играет. list — ln-… из ссылки
   * «Поделиться»: у роликов с доступом по ссылке страница ролика без него может не открыться
   */
  | { provider: 'vk'; ownerId: string; id: string; hash?: string; list?: string }

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const RUTUBE_ID = /^[0-9a-f]{32}$/
const RUTUBE_KEY = /^[A-Za-z0-9_-]{1,64}$/
const VK_VIDEO = /^(?:video|clip)(-?\d{1,19})_(\d{1,19})$/
const VK_HASH = /^[0-9a-f]{1,64}$/
const VK_LIST = /^ln-[A-Za-z0-9_-]{1,64}$/

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const YOUTUBE_NOCOOKIE_HOSTS = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com'])
const RUTUBE_HOSTS = new Set(['rutube.ru', 'www.rutube.ru', 'm.rutube.ru'])
const VK_HOSTS = new Set(
  ['vk.com', 'vk.ru', 'vkvideo.ru'].flatMap((host) => [host, `www.${host}`, `m.${host}`]),
)

/**
 * Адрес целиком: схема, хост без логина и порта, путь, строка запроса и фрагмент. Свой разбор, а не
 * URL: у схемы нет API среды (её проверки идут и в браузере админки, и в MCP). Хост — только
 * латиница, цифры, точки и дефисы: «youtu.be@evil.ru», «youtu.be:8443» и обратная косая черта сюда
 * не подходят
 */
const ADDRESS = /^https?:\/\/([a-z0-9.-]+)(\/[^?#\s]*)?(?:\?([^#\s]*))?(?:#\S*)?$/i

type Address = { host: string; parts: string[]; query: Map<string, string> }

function parseAddress(input: string): Address | undefined {
  const match = ADDRESS.exec(input.trim())
  if (!match?.[1]) return undefined
  // Части пути без пустых: /video/abc/ → ['video', 'abc']. Не раскодируем: в id площадок нет
  // %-кодов, и закодированный символ просто не пройдёт проверку id
  const parts = (match[2] ?? '').split('/').filter(Boolean)
  const query = new Map<string, string>()
  for (const pair of (match[3] ?? '').split('&')) {
    if (!pair) continue
    const at = pair.indexOf('=')
    const [rawKey, rawValue] = at < 0 ? [pair, ''] : [pair.slice(0, at), pair.slice(at + 1)]
    try {
      const key = decodeURIComponent(rawKey.replaceAll('+', ' '))
      // Первое значение главнее, как у URLSearchParams.get
      if (!query.has(key)) query.set(key, decodeURIComponent(rawValue.replaceAll('+', ' ')))
    } catch {
      return undefined
    }
  }
  return { host: match[1].toLowerCase(), parts, query }
}

function youtube({ host, parts, query }: Address): VideoRef | undefined {
  let id: string | undefined
  if (host === 'youtu.be') {
    id = parts.length === 1 ? parts[0] : undefined
  } else if (YOUTUBE_NOCOOKIE_HOSTS.has(host)) {
    id = parts.length === 2 && parts[0] === 'embed' ? parts[1] : undefined
  } else if (parts.length === 1 && parts[0] === 'watch') {
    id = query.get('v')
  } else if (parts.length === 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) {
    id = parts[1]
  }
  return id && YOUTUBE_ID.test(id) ? { provider: 'youtube', id } : undefined
}

function rutube({ parts, query }: Address): VideoRef | undefined {
  const raw =
    parts.length === 2 && (parts[0] === 'video' || parts[0] === 'shorts')
      ? parts[1]
      : parts.length === 3 && parts[0] === 'video' && parts[1] === 'private'
        ? parts[2]
        : parts.length === 3 && parts[0] === 'play' && parts[1] === 'embed'
          ? parts[2]
          : undefined
  const id = raw?.toLowerCase()
  if (!id || !RUTUBE_ID.test(id)) return undefined
  const key = query.get('p')
  if (key === undefined) return { provider: 'rutube', id }
  return RUTUBE_KEY.test(key) ? { provider: 'rutube', id, privateKey: key } : undefined
}

function vk({ parts, query }: Address): VideoRef | undefined {
  if (parts.length === 1 && parts[0] === 'video_ext.php') {
    const ownerId = query.get('oid') ?? ''
    const id = query.get('id') ?? ''
    const hash = query.get('hash')
    if (!/^-?\d{1,19}$/.test(ownerId) || !/^\d{1,19}$/.test(id)) return undefined
    if (hash === undefined) return { provider: 'vk', ownerId, id }
    return VK_HASH.test(hash) ? { provider: 'vk', ownerId, id, hash } : undefined
  }
  // Ролик, открытый поверх страницы сообщества или раздела: ?z=video-1_2/… — адрес ролика в z
  const z = query.get('z')
  const name = z !== undefined ? z.split('/')[0] : parts.length === 1 ? parts[0] : undefined
  const match = name ? VK_VIDEO.exec(name) : null
  if (!match?.[1] || !match[2]) return undefined
  // Другие list (подборка, плейлист) ролику не нужны — выбрасываются
  const list = query.get('list')
  return list && VK_LIST.test(list)
    ? { provider: 'vk', ownerId: match[1], id: match[2], list }
    : { provider: 'vk', ownerId: match[1], id: match[2] }
}

/**
 * Ролик по ссылке: адрес из строки браузера, кнопки «Поделиться» или кода вставки. Только https
 * и http, без логина и порта в адресе, только домены площадок. Не узнали — undefined
 */
export function parseVideoUrl(input: string): VideoRef | undefined {
  const address = parseAddress(input)
  if (!address) return undefined
  const { host } = address
  if (host === 'youtu.be' || YOUTUBE_HOSTS.has(host) || YOUTUBE_NOCOOKIE_HOSTS.has(host)) {
    return youtube(address)
  }
  if (RUTUBE_HOSTS.has(host)) return rutube(address)
  if (VK_HOSTS.has(host)) return vk(address)
  return undefined
}

/** Страница ролика на площадке: на неё ведёт ссылка «Смотреть на …» — и без JavaScript */
export function videoWatchUrl(ref: VideoRef) {
  switch (ref.provider) {
    case 'youtube':
      return `https://www.youtube.com/watch?v=${ref.id}`
    case 'rutube':
      return ref.privateKey
        ? `https://rutube.ru/video/private/${ref.id}/?p=${ref.privateKey}`
        : `https://rutube.ru/video/${ref.id}/`
    case 'vk':
      return `https://vkvideo.ru/video${ref.ownerId}_${ref.id}${ref.list ? `?list=${ref.list}` : ''}`
  }
}

/**
 * Адрес плеера для iframe, который ставится по клику: сразу с автозапуском — человек уже нажал
 * «смотреть». YouTube — с домена youtube-nocookie.com: до запуска ролика он не ставит cookie.
 * autoplay=true у Rutube — из документации плеера, но площадка не обещает, что он работает: бывает,
 * что ролик ждёт второго нажатия уже в плеере
 */
export function videoEmbedUrl(ref: VideoRef) {
  switch (ref.provider) {
    case 'youtube':
      return `https://www.youtube-nocookie.com/embed/${ref.id}?autoplay=1`
    case 'rutube':
      return ref.privateKey
        ? `https://rutube.ru/play/embed/${ref.id}/?p=${ref.privateKey}&autoplay=true`
        : `https://rutube.ru/play/embed/${ref.id}/?autoplay=true`
    case 'vk': {
      const hash = ref.hash ? `&hash=${ref.hash}` : ''
      return `https://vkvideo.ru/video_ext.php?oid=${ref.ownerId}&id=${ref.id}${hash}&hd=2&autoplay=1`
    }
  }
}

export const VIDEO_URL_MESSAGE =
  'Нужна ссылка на ролик YouTube, Rutube или VK Видео: например https://youtu.be/…, https://rutube.ru/video/… или https://vkvideo.ru/video-…'

/**
 * Поле «ссылка на ролик»: строка, которую можно разобрать в ролик одной из трёх площадок. Шаблон
 * адреса попадает в JSON Schema как pattern — по нему редактор делает поле однострочным, как у
 * других ссылок (Enter не вставит перенос). abort — чтобы человек в админке увидел одну
 * ошибку, а не две одинаковых
 */
export const VideoUrl = z
  .string()
  .trim()
  .min(1, { message: VIDEO_URL_MESSAGE, abort: true })
  .max(500)
  .regex(/^https?:\/\//i, { message: VIDEO_URL_MESSAGE, abort: true })
  .refine((value) => parseVideoUrl(value) !== undefined, VIDEO_URL_MESSAGE)
