import { z } from 'zod'

/**
 * Сборка сайта на сервере после публикации (модуль 9): ждёт очереди, идёт, готова (новая версия
 * уже на сайте) или упала (на сайте осталась прежняя версия)
 */
export const SiteBuildStatus = z.enum(['queued', 'running', 'succeeded', 'failed'])
export type SiteBuildStatus = z.infer<typeof SiteBuildStatus>
