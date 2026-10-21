/**
 * PNG-иконки сайта: их делает API из картинки, выбранной в «SEO». Отдельный модуль без
 * astro:env — его читает и astro.config.mjs (точные маршруты иконок в dev)
 */
export const ICON_FILES = ['apple-touch-icon', 'icon-192', 'icon-512'] as const
