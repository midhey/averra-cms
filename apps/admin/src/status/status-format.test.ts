import type { BackupRun } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import {
  describeBackup,
  describeDisk,
  describeMail,
  describeUpdate,
  formatSize,
} from './status-format'

const run: BackupRun = {
  name: '20261016-033000-scheduled',
  kind: 'scheduled',
  startedAt: '2026-10-16T03:30:00Z',
  finishedAt: '2026-10-16T03:31:00Z',
  ok: true,
  verified: true,
  dbBytes: 3 * 1024 ** 2,
  mediaBytes: 2 * 1024 ** 2,
  remote: 'uploaded',
  error: null,
}

describe('состояние установки словами', () => {
  it('бэкап: удачный с копией, неудачный с причиной', () => {
    expect(describeBackup(run)).toMatch(
      /по расписанию — проверен восстановлением, 5 МБ, копия во внешнем хранилище$/,
    )
    expect(describeBackup({ ...run, ok: false, error: 'pg_dump не прошёл' })).toMatch(
      /— не удался: pg_dump не прошёл$/,
    )
    expect(describeBackup({ ...run, remote: 'failed' })).toContain('не выгрузилась')
    expect(describeBackup({ ...run, remote: 'cleanup-failed' })).toContain(
      'старые копии там не удалились',
    )
  })

  it('почта: письма с ошибкой в очереди — «не уходят», а не «работает»', () => {
    const mail = {
      enabled: true,
      reason: null,
      failedRecent: 0,
      pending: 4,
      failing: 4,
      failingSince: run.startedAt,
    }
    const later = new Date(Date.parse(run.startedAt) + 20 * 60_000)
    expect(describeMail(mail, later)).toBe(
      'письма не уходят — в очереди с ошибкой: 4; не ушло за неделю: 0, ждут отправки: 4',
    )
    // Ошибке пять минут — ещё повтор, как и у проблемы mail_failing (порог 15 минут)
    const soon = new Date(Date.parse(run.startedAt) + 5 * 60_000)
    expect(describeMail(mail, soon)).toMatch(/^работает, повторяет отправку после ошибки: 4;/)
    expect(describeMail({ ...mail, failing: 0, failingSince: null }, later)).toMatch(/^работает;/)
    expect(describeMail({ ...mail, enabled: false, reason: 'Почта не настроена' }, later)).toMatch(
      /^выключена: Почта не настроена;/,
    )
  })

  it('обновление: база с данными после бэкапа сохранена при откате', () => {
    expect(
      describeUpdate({
        from: '0.6.0',
        to: '0.7.0',
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        result: 'rolled-back',
        dbRestored: true,
        keptDatabase: 'averra_rolled_back_20261016_033000',
        error: null,
      }),
    ).toContain('сохранены в базе averra_rolled_back_20261016_033000')
  })

  it('размеры и диск', () => {
    expect(formatSize(100)).toBe('1 МБ')
    expect(formatSize(5 * 1024 ** 3)).toBe('5,0 ГБ')
    expect(describeDisk({ freeBytes: 10 * 1024 ** 3, totalBytes: 40 * 1024 ** 3 })).toBe(
      'свободно 10,0 ГБ из 40,0 ГБ (25 %)',
    )
  })

  it('обновление: откат с восстановлением базы', () => {
    expect(
      describeUpdate({
        from: '0.6.0',
        to: '0.7.0',
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        result: 'rolled-back',
        dbRestored: true,
        keptDatabase: null,
        error: null,
      }),
    ).toMatch(
      /^0\.6\.0 → 0\.7\.0, .+: не прошло проверку, вернулась прежняя версия \(база восстановлена из бэкапа\)$/,
    )
  })

  it('обновление не начато — с причиной: «не скачались образы» и «не удался бэкап» чинятся по-разному', () => {
    expect(
      describeUpdate({
        from: '0.6.0',
        to: '0.7.0',
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        result: 'failed',
        dbRestored: false,
        keptDatabase: null,
        error: 'в образе нет compose.yaml или averra.sh',
      }),
    ).toMatch(/: не начато, версия прежняя: в образе нет compose.yaml или averra.sh$/)
  })
})
