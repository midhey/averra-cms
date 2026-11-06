/**
 * Content-Security-Policy опубликованного сайта — одна строка на весь сайт. Её ставит заголовком
 * dev-сервер рендерера, а сборка кладёт в _averra/csp.txt релиза: Caddy читает этот файл на
 * каждый запрос (deploy/Caddyfile). Решение и разбор директив — документация «Решения → Свой JS на
 * сайте» и «Разработчику → Безопасность»
 */

/** Файл с CSP в релизе сайта: его читает Caddy домена сайта */
export const SITE_CSP_FILE = '_averra/csp.txt'

/**
 * Адреса Метрики из её документации («Установка счётчика при использовании CSP»): счётчик ходит
 * на mc.yandex.<страна посетителя>, поэтому весь список, а не один mc.yandex.ru
 */
const METRIKA_HOSTS = [
  'mc.yandex.ru',
  'mc.yandex.az',
  'mc.yandex.by',
  'mc.yandex.co.il',
  'mc.yandex.com',
  'mc.yandex.com.am',
  'mc.yandex.com.ge',
  'mc.yandex.com.tr',
  'mc.yandex.ee',
  'mc.yandex.fr',
  'mc.yandex.kg',
  'mc.yandex.kz',
  'mc.yandex.lt',
  'mc.yandex.lv',
  'mc.yandex.md',
  'mc.yandex.tj',
  'mc.yandex.tm',
  'mc.yandex.uz',
  'mc.webvisor.com',
  'mc.webvisor.org',
]
const METRIKA_HTTPS = METRIKA_HOSTS.map((host) => `https://${host}`)
const METRIKA = {
  script: [...METRIKA_HTTPS, 'https://yastatic.net'],
  img: METRIKA_HTTPS,
  connect: [...METRIKA_HTTPS, ...METRIKA_HOSTS.map((host) => `wss://${host}`)],
  frame: METRIKA_HTTPS,
  // Карта кликов и ссылок открывает сайт во фрейме интерфейса Метрики
  ancestors: [
    'https://metrika.yandex.ru',
    'https://metrika.yandex.by',
    'https://metrika.yandex.kz',
    'https://metrika.yandex.uz',
    'https://metrika.yandex.com',
    'https://metrika.yandex.com.tr',
    'https://metrica.yandex.com',
    'https://metrica.yandex.com.tr',
    'https://metrika.ya.ru',
    'https://metrica.ya.ru',
  ],
}

/** GA4 по документации Google (Tag Manager и CSP) */
const GA4 = {
  script: ['https://*.googletagmanager.com'],
  img: ['https://*.google-analytics.com', 'https://*.googletagmanager.com'],
  connect: [
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://*.googletagmanager.com',
  ],
}

/** Плеер блока «Видео» ставит iframe этих площадок (packages/schema/src/video.ts) */
const VIDEO_FRAMES = ['https://www.youtube-nocookie.com', 'https://rutube.ru', 'https://vkvideo.ru']

export type SiteCspInput = {
  /** Номер счётчика Метрики из настроек ('' — нет) */
  metrika: string
  /** Поток GA4 ('' — нет) */
  ga4: string
  /** Домены, которые владелец разрешил скрипту сайта (SiteScript.origins) */
  origins: readonly string[]
  /**
   * Источник API, если картинки и формы сайта ведут на него (dev-сервер, CMS_LINKS=api). null —
   * всё от корня сайта (публикация на сервере)
   */
  apiOrigin?: string | null
}

const list = (...parts: readonly (readonly string[])[]) => [...new Set(parts.flat())].join(' ')

/**
 * Строка CSP сайта. Скрипты — только файлами с самого сайта (без 'unsafe-inline' и 'unsafe-eval')
 * плюс включённые интеграции и домены владельца. Стили — с 'unsafe-inline': тема и CSS своих блоков
 * лежат в <style> страницы, а CSS блоков уже очищен движком (без url() наружу и @import)
 */
export function siteCsp({ metrika, ga4, origins, apiOrigin = null }: SiteCspInput) {
  const m = metrika !== ''
  const g = ga4 !== ''
  const api = apiOrigin ? [apiOrigin] : []
  const directives: [string, string][] = [
    ['default-src', "'self'"],
    ['script-src', list(["'self'"], m ? METRIKA.script : [], g ? GA4.script : [], origins)],
    ['style-src', list(["'self'", "'unsafe-inline'"], origins)],
    ['img-src', list(["'self'", 'data:'], api, m ? METRIKA.img : [], g ? GA4.img : [], origins)],
    ['font-src', list(["'self'"], origins)],
    ['connect-src', list(["'self'"], m ? METRIKA.connect : [], g ? GA4.connect : [], origins)],
    ['media-src', list(["'self'"], api)],
    ['frame-src', list(VIDEO_FRAMES, m ? METRIKA.frame : [], origins)],
    ['form-action', list(["'self'"], api)],
    ['base-uri', "'self'"],
    ['object-src', "'none'"],
    ['frame-ancestors', list(["'self'"], m ? METRIKA.ancestors : [])],
  ]
  return directives.map(([name, value]) => `${name} ${value}`).join('; ')
}
