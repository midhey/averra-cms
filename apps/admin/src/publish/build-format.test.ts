import { describe, expect, it } from 'vitest'
import {
  buildStatusLabels,
  buildSummary,
  failedBuildOutcome,
  formatMegabytes,
  isBuildActive,
} from './build-format'

describe('сборка сайта словами', () => {
  it('состояния', () => {
    expect(buildStatusLabels.succeeded).toBe('Собран')
    expect(buildStatusLabels.failed).toBe('Сборка упала')
  })

  it('экран опрашивает сборку, только пока она ждёт или идёт', () => {
    expect(isBuildActive('queued')).toBe(true)
    expect(isBuildActive('running')).toBe(true)
    expect(isBuildActive('succeeded')).toBe(false)
    expect(isBuildActive('failed')).toBe(false)
    expect(isBuildActive(undefined)).toBe(false)
  })

  it('память — в мегабайтах', () => {
    expect(formatMegabytes(372_342_784)).toBe('355 МБ')
  })

  it('упавшая сборка: прежняя версия — только если удачная сборка была', () => {
    expect(failedBuildOutcome(true)).toBe('На сайте осталась прежняя версия.')
    expect(failedBuildOutcome(false)).toBe('Сайт пока не собран.')
  })

  it('последняя сборка коротко: итог, длительность, тон и когда', () => {
    const run = {
      requestedAt: '2026-10-19T09:13:00.000Z',
      startedAt: '2026-10-19T09:13:30.000Z',
      finishedAt: '2026-10-19T09:14:11.000Z',
    }
    expect(buildSummary({ ...run, status: 'succeeded' })).toEqual({
      label: 'Успешно, 41 с',
      tone: 'success',
      at: run.finishedAt,
    })
    expect(buildSummary({ ...run, status: 'failed' })).toMatchObject({
      label: 'Упала',
      tone: 'danger',
    })
    expect(buildSummary({ ...run, status: 'running', finishedAt: null })).toEqual({
      label: 'Собирается',
      tone: 'info',
      at: run.startedAt,
    })
    expect(buildSummary({ ...run, status: 'queued', startedAt: null, finishedAt: null })).toEqual({
      label: 'Ждёт очереди',
      tone: 'info',
      at: run.requestedAt,
    })
  })
})
