import type { SiteBuildStatus } from '@averra/schema'

// Сборка сайта на сервере словами. Решает всё API, здесь только слова

export const buildStatusLabels: Record<SiteBuildStatus, string> = {
  queued: 'Ждёт очереди',
  running: 'Собирается',
  succeeded: 'Собран',
  failed: 'Сборка упала',
}

/** Пока сборка ждёт или идёт, экран сам спрашивает её состояние */
export const isBuildActive = (status: SiteBuildStatus | undefined) =>
  status === 'queued' || status === 'running'

/** Память сборки в мегабайтах — по ней видно, хватает ли VPS */
export const formatMegabytes = (bytes: number) => `${Math.round(bytes / 2 ** 20)} МБ`
