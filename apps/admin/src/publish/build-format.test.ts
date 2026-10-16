import { describe, expect, it } from 'vitest'
import { buildStatusLabels, formatMegabytes, isBuildActive } from './build-format'

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
})
