import { type BackupRun, type InstallationStatus, NO_RELEASE_STATE } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import { statusLines } from './lines'

// Состояние строками для терминала сервера (status.js): слова по-русски и без неправды

const checkedAt = '2026-10-16T12:00:00.000Z'

const backup = (overrides: Partial<BackupRun> = {}): BackupRun => ({
  name: '20261016-033000-scheduled',
  kind: 'scheduled',
  startedAt: '2026-10-16T03:30:00Z',
  finishedAt: '2026-10-16T03:31:00Z',
  ok: true,
  verified: true,
  dbBytes: 1,
  mediaBytes: 1,
  remote: 'off',
  error: null,
  ...overrides,
})

function status(overrides: Partial<InstallationStatus> = {}): InstallationStatus {
  return {
    version: '0.7.0',
    checkedAt,
    db: { up: true, migrations: 15, serviceDatabases: [] },
    backup: { enabled: true, unreadable: false, last: backup(), lastOk: backup() },
    update: null,
    updateUnreadable: false,
    release: NO_RELEASE_STATE,
    publish: {
      enabled: true,
      last: { siteName: 'Ремонт', status: 'succeeded', at: '2026-10-16T10:00:00.000Z' },
      failedSites: 0,
    },
    mail: {
      enabled: true,
      reason: null,
      failedRecent: 0,
      pending: 0,
      failing: 0,
      failingSince: null,
    },
    disk: [],
    problems: [],
    ...overrides,
  }
}

const text = (value: InstallationStatus) => statusLines(value).join('\n')

describe('statusLines', () => {
  it('неудачный бэкап со сбоем чистки хранилища — без «копия выгружена»: копии не было', () => {
    const failed = backup({
      ok: false,
      verified: false,
      error: 'pg_dump не прошёл',
      remote: 'cleanup-failed',
    })
    const lines = text(
      status({ backup: { enabled: true, unreadable: false, last: failed, lastOk: null } }),
    )
    expect(lines).toContain('не удался: pg_dump не прошёл; старые копии в хранилище НЕ удалились')
    expect(lines).not.toContain('копия выгружена')
    const ok = backup({ remote: 'cleanup-failed' })
    expect(
      text(status({ backup: { enabled: true, unreadable: false, last: ok, lastOk: ok } })),
    ).toContain('копия выгружена, но старые копии в хранилище НЕ удалились')
  })

  it('итоги обновления и сборки — словами, а не кодами', () => {
    const lines = text(
      status({
        update: {
          from: '0.6.0',
          to: '0.7.0',
          startedAt: '2026-10-16T09:00:00Z',
          finishedAt: '2026-10-16T09:05:00Z',
          result: 'rolled-back',
          dbRestored: true,
          keptDatabase: null,
          step: null,
          failedStep: null,
          error: null,
        },
      }),
    )
    expect(lines).toContain('0.6.0 → 0.7.0, не прошло проверку, вернулась прежняя версия')
    expect(lines).not.toContain('rolled-back')
    expect(lines).toContain('последняя — «Ремонт», собран')
    expect(lines).not.toContain('succeeded')
    const running = text(
      status({
        update: {
          from: '0.6.0',
          to: '0.7.0',
          startedAt: '2026-10-16T11:50:00Z',
          finishedAt: null,
          result: 'in-progress',
          dbRestored: false,
          keptDatabase: null,
          step: null,
          failedStep: null,
          error: null,
        },
      }),
    )
    expect(running).toContain('0.6.0 → 0.7.0, идёт')
    const failed = text(
      status({
        update: {
          from: '0.6.0',
          to: '0.7.0',
          startedAt: '2026-10-16T09:00:00Z',
          finishedAt: '2026-10-16T09:01:00Z',
          result: 'failed',
          dbRestored: false,
          keptDatabase: null,
          step: null,
          failedStep: null,
          error: 'API не остановился перед бэкапом',
        },
      }),
    )
    // Причина «не начато» — в строке: образы, бэкап и обрыв чинятся по-разному
    expect(failed).toContain(
      '0.6.0 → 0.7.0, не начато, версия прежняя: API не остановился перед бэкапом',
    )
    expect(text(status({ updateUnreadable: true }))).toContain(
      'Обновление:  файл состояния не читается',
    )
  })

  it('почта «не уходит» только после порога, как проблема mail_failing', () => {
    const mail = (minutes: number) =>
      status({
        mail: {
          enabled: true,
          reason: null,
          failedRecent: 0,
          pending: 1,
          failing: 1,
          failingSince: new Date(Date.parse(checkedAt) - minutes * 60_000).toISOString(),
        },
      })
    expect(text(mail(5))).toMatch(/Почта:\s+включена;/)
    expect(text(mail(20))).toMatch(/Почта:\s+письма не уходят;/)
  })

  it('служебные базы с копиями данных видны', () => {
    expect(
      text(
        status({
          db: {
            up: true,
            migrations: 15,
            serviceDatabases: ['averra_failed_restore_20261016_100000'],
          },
        }),
      ),
    ).toContain('Служебные базы: averra_failed_restore_20261016_100000')
  })
})
