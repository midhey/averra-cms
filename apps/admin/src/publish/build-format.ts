import { SITE_BUILD_STATUS_LABELS, type SiteBuildStatus } from '@averra/schema'
import { formatDuration } from '../format/time'
import type { StatusTone } from '../ui/StatusPill'

// Сборка сайта на сервере словами. Решает всё API, здесь только слова

/** Слова — общие со status.js на сервере (схема) */
export const buildStatusLabels = SITE_BUILD_STATUS_LABELS

/** Пока сборка ждёт или идёт, экран сам спрашивает её состояние */
export const isBuildActive = (status: SiteBuildStatus | undefined) =>
  status === 'queued' || status === 'running'

/** Память сборки в мегабайтах — по ней видно, хватает ли VPS */
export const formatMegabytes = (bytes: number) => `${Math.round(bytes / 2 ** 20)} МБ`

/**
 * Что на сайте после упавшей сборки: прежняя версия, если удачная сборка была, иначе — ничего.
 * «Осталась прежняя версия» у сайта, который ни разу не собирался, противоречила бы строке выше
 */
export const failedBuildOutcome = (hasLiveVersion: boolean) =>
  hasLiveVersion ? 'На сайте осталась прежняя версия.' : 'Сайт пока не собран.'

type BuildRun = {
  status: SiteBuildStatus
  startedAt: string | null
  finishedAt: string | null
  requestedAt: string
}

/**
 * Последняя сборка коротко — для карточки обзора и строки сведений: что с ней словами, тон
 * точки и когда (время, от которого считать «15 минут назад»)
 */
export function buildSummary(run: BuildRun): { label: string; tone: StatusTone; at: string } {
  if (run.status === 'succeeded') {
    const took =
      run.startedAt && run.finishedAt
        ? `, ${formatDuration(Date.parse(run.finishedAt) - Date.parse(run.startedAt))}`
        : ''
    return { label: `Успешно${took}`, tone: 'success', at: run.finishedAt ?? run.requestedAt }
  }
  if (run.status === 'failed') {
    return { label: 'Упала', tone: 'danger', at: run.finishedAt ?? run.requestedAt }
  }
  return {
    label: buildStatusLabels[run.status],
    tone: 'info',
    at: run.startedAt ?? run.requestedAt,
  }
}
