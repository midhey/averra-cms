import { SITE_BUILD_STATUS_LABELS, type SiteBuildStatus } from '@averra/schema'

// Сборка сайта на сервере словами. Решает всё API, здесь только слова

/** Слова — общие со status.js на сервере (схема) */
export const buildStatusLabels = SITE_BUILD_STATUS_LABELS

/** Пока сборка ждёт или идёт, экран сам спрашивает её состояние */
export const isBuildActive = (status: SiteBuildStatus | undefined) =>
  status === 'queued' || status === 'running'

/** Память сборки в мегабайтах — по ней видно, хватает ли VPS */
export const formatMegabytes = (bytes: number) => `${Math.round(bytes / 2 ** 20)} МБ`
