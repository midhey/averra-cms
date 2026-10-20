import { z } from 'zod'

/**
 * Сборка сайта на сервере после публикации: ждёт очереди, идёт, готова (новая версия
 * уже на сайте) или упала (на сайте осталась прежняя версия)
 */
export const SiteBuildStatus = z.enum(['queued', 'running', 'succeeded', 'failed'])
export type SiteBuildStatus = z.infer<typeof SiteBuildStatus>

/** Состояние сборки словами: одни для админки и команды состояния на сервере (status.js) */
export const SITE_BUILD_STATUS_LABELS: Record<SiteBuildStatus, string> = {
  queued: 'Ждёт очереди',
  running: 'Собирается',
  succeeded: 'Собран',
  failed: 'Сборка упала',
}
