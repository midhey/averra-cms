import { describe, expect, it } from 'vitest'
import {
  BackupRun,
  type InstallationFacts,
  statusProblems,
  UpdateRun,
  updateResultText,
} from './status'

const now = new Date('2026-10-16T12:00:00Z')
const hoursBefore = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString()

const okBackup = (hours: number): BackupRun => ({
  name: '20261016-033000-scheduled',
  kind: 'scheduled',
  startedAt: hoursBefore(hours),
  finishedAt: hoursBefore(hours),
  ok: true,
  verified: true,
  dbBytes: 1000,
  mediaBytes: 2000,
  remote: 'off',
  error: null,
})

function facts(overrides: Partial<InstallationFacts> = {}): InstallationFacts {
  return {
    version: '0.7.0',
    checkedAt: now.toISOString(),
    db: { up: true, migrations: 15, serviceDatabases: [] },
    backup: { enabled: true, unreadable: false, last: okBackup(3), lastOk: okBackup(3) },
    update: null,
    updateUnreadable: false,
    publish: { enabled: true, last: null, failedSites: 0 },
    mail: {
      enabled: true,
      reason: null,
      failedRecent: 0,
      pending: 0,
      failing: 0,
      failingSince: null,
    },
    disk: [{ label: 'сайты и медиа', freeBytes: 20 * 1024 ** 3, totalBytes: 40 * 1024 ** 3 }],
    ...overrides,
  }
}

const codes = (value: InstallationFacts) => statusProblems(value, now).map((p) => p.code)

describe('statusProblems', () => {
  it('исправная установка — проблем нет', () => {
    expect(statusProblems(facts(), now)).toEqual([])
  })

  it('бэкапы: не было, старше двух суток, последний упал, копия не выгрузилась, файл не читается', () => {
    expect(
      codes(facts({ backup: { enabled: true, unreadable: false, last: null, lastOk: null } })),
    ).toEqual(['backup_missing'])
    expect(
      codes(
        facts({
          backup: { enabled: true, unreadable: false, last: okBackup(47), lastOk: okBackup(47) },
        }),
      ),
    ).toEqual([])
    const stale = statusProblems(
      facts({
        backup: { enabled: true, unreadable: false, last: okBackup(50), lastOk: okBackup(50) },
      }),
      now,
    )
    expect(stale).toEqual([
      { code: 'backup_stale', message: 'Последний удачный бэкап — 50 ч назад' },
    ])
    const failed = { ...okBackup(1), ok: false, verified: false, error: 'pg_dump не прошёл' }
    const withFailed = statusProblems(
      facts({ backup: { enabled: true, unreadable: false, last: failed, lastOk: okBackup(20) } }),
      now,
    )
    expect(withFailed).toEqual([
      { code: 'backup_failed', message: 'Последний бэкап не удался: pg_dump не прошёл' },
    ])
    const remote = { ...okBackup(1), remote: 'failed' as const }
    expect(
      codes(facts({ backup: { enabled: true, unreadable: false, last: remote, lastOk: remote } })),
    ).toEqual(['backup_remote_failed'])
    expect(
      codes(facts({ backup: { enabled: true, unreadable: true, last: null, lastOk: null } })),
    ).toEqual(['backup_unreadable', 'backup_missing'])
  })

  it('без папки состояния (разработка) бэкапы не тревожат', () => {
    expect(
      codes(facts({ backup: { enabled: false, unreadable: false, last: null, lastOk: null } })),
    ).toEqual([])
  })

  it('откат при обновлении виден неделю, удачное обновление — не проблема', () => {
    const update: UpdateRun = {
      from: '0.6.0',
      to: '0.7.0',
      startedAt: hoursBefore(2),
      finishedAt: hoursBefore(2),
      result: 'rolled-back',
      dbRestored: true,
      keptDatabase: null,
      error: 'API новой версии не ответил',
    }
    expect(statusProblems(facts({ update }), now)).toEqual([
      {
        code: 'update_rolled_back',
        message:
          'Обновление до 0.7.0 не прошло проверку — вернулась версия 0.6.0, база восстановлена из бэкапа перед обновлением',
      },
    ])
    expect(codes(facts({ update: { ...update, result: 'rollback-failed' } }))).toEqual([
      'update_rollback_failed',
    ])
    expect(codes(facts({ update: { ...update, finishedAt: hoursBefore(8 * 24) } }))).toEqual([])
    expect(codes(facts({ update: { ...update, result: 'updated' } }))).toEqual([])
  })

  it('откат сохранил базу с данными после бэкапа — об этом говорится, пока откат свежий', () => {
    const update: UpdateRun = {
      from: '0.6.0',
      to: '0.7.0',
      startedAt: hoursBefore(2),
      finishedAt: hoursBefore(2),
      result: 'rolled-back',
      dbRestored: true,
      keptDatabase: 'averra_rolled_back_20261016_100000',
      error: null,
    }
    const problems = statusProblems(facts({ update }), now)
    expect(problems.map((p) => p.code)).toEqual(['update_rolled_back', 'update_kept_database'])
    expect(problems[1]?.message).toContain('averra_rolled_back_20261016_100000')
    expect(codes(facts({ update: { ...update, finishedAt: hoursBefore(8 * 24) } }))).toEqual([])
  })

  it('обновление «идёт» дольше часа — оборвалось; файл обновления не читается — сказано', () => {
    const running: UpdateRun = {
      from: '0.6.0',
      to: '0.7.0',
      startedAt: hoursBefore(0.5),
      finishedAt: null,
      result: 'in-progress',
      dbRestored: false,
      keptDatabase: null,
      error: null,
    }
    // Идёт полчаса — это обычное обновление, не проблема
    expect(codes(facts({ update: running }))).toEqual([])
    const stale = statusProblems(facts({ update: { ...running, startedAt: hoursBefore(2) } }), now)
    expect(stale.map((p) => p.code)).toEqual(['update_interrupted'])
    expect(stale[0]?.message).toContain('averra.sh update --version 0.7.0')
    expect(codes(facts({ updateUnreadable: true }))).toEqual(['update_unreadable'])
  })

  it('служебные базы с копиями данных видны; база от свежего отката — одной проблемой', () => {
    const kept = 'averra_rolled_back_20261016_100000'
    const problems = statusProblems(
      facts({
        db: {
          up: true,
          migrations: 15,
          serviceDatabases: ['averra_before_restore', 'averra_failed_restore_20261015_100000'],
        },
      }),
      now,
    )
    expect(problems.map((p) => p.code)).toEqual(['db_service_databases'])
    expect(problems[0]?.message).toContain('averra_before_restore — прежняя рабочая база')
    expect(problems[0]?.message).toContain('удалятся вместе со старыми бэкапами')
    const update: UpdateRun = {
      from: '0.6.0',
      to: '0.7.0',
      startedAt: hoursBefore(2),
      finishedAt: hoursBefore(2),
      result: 'rolled-back',
      dbRestored: true,
      keptDatabase: kept,
      error: null,
    }
    // Об отложенной базе свежего отката уже говорит update_kept_database
    expect(
      codes(facts({ update, db: { up: true, migrations: 15, serviceDatabases: [kept] } })),
    ).toEqual(['update_rolled_back', 'update_kept_database'])
    // Откат давний — база всё ещё лежит, это видно
    expect(
      codes(
        facts({
          update: { ...update, finishedAt: hoursBefore(8 * 24) },
          db: { up: true, migrations: 15, serviceDatabases: [kept] },
        }),
      ),
    ).toEqual(['db_service_databases'])
  })

  it('почта: письма с ошибкой в очереди дольше 15 минут — не уходят, хоть и не failed', () => {
    const mail = (failing: number, minutes: number | null) =>
      facts({
        mail: {
          enabled: true,
          reason: null,
          failedRecent: 0,
          pending: failing,
          failing,
          failingSince:
            minutes === null ? null : new Date(now.getTime() - minutes * 60_000).toISOString(),
        },
      })
    expect(statusProblems(mail(3, 60), now)).toEqual([
      {
        code: 'mail_failing',
        message: 'Письма не уходят: в очереди с ошибкой 3 — проверьте настройки почты',
      },
    ])
    // Разовый сбой, письмо ещё повторяется — не тревога
    expect(codes(mail(1, 5))).toEqual([])
    expect(codes(mail(0, null))).toEqual([])
  })

  it('старые копии во внешнем хранилище не удалились — проблема (срок хранения)', () => {
    const run = { ...okBackup(1), remote: 'cleanup-failed' as const }
    expect(
      codes(facts({ backup: { enabled: true, unreadable: false, last: run, lastOk: run } })),
    ).toEqual(['backup_remote_cleanup_failed'])
  })

  it('база, почта, сборки и диск', () => {
    expect(codes(facts({ db: { up: false, migrations: null, serviceDatabases: [] } }))).toEqual([
      'db_down',
    ])
    expect(
      statusProblems(
        facts({
          mail: {
            enabled: false,
            reason: 'Почта не настроена',
            failedRecent: 2,
            pending: 1,
            failing: 0,
            failingSince: null,
          },
        }),
        now,
      ),
    ).toEqual([
      { code: 'mail_disabled', message: 'Почта не настроена' },
      { code: 'mail_failed', message: 'Писем не ушло за неделю: 2' },
    ])
    expect(codes(facts({ publish: { enabled: true, last: null, failedSites: 1 } }))).toEqual([
      'build_failed',
    ])
    // Меньше 1 ГБ или меньше 10 % — мало
    expect(
      codes(
        facts({ disk: [{ label: 'x', freeBytes: 900 * 1024 ** 2, totalBytes: 2 * 1024 ** 3 }] }),
      ),
    ).toEqual(['disk_low'])
    expect(
      codes(
        facts({ disk: [{ label: 'x', freeBytes: 5 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 }] }),
      ),
    ).toEqual(['disk_low'])
    expect(
      codes(
        facts({ disk: [{ label: 'x', freeBytes: 15 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 }] }),
      ),
    ).toEqual([])
  })
})

describe('файлы состояния скрипта сервера', () => {
  it('UpdateRun: файл без keptDatabase (прежний averra.sh) читается, чужое имя базы — нет', () => {
    const run = {
      from: '0.6.0',
      to: '0.7.0',
      startedAt: hoursBefore(1),
      finishedAt: hoursBefore(1),
      result: 'updated',
      dbRestored: false,
      error: null,
    }
    expect(UpdateRun.parse(run).keptDatabase).toBeNull()
    expect(UpdateRun.safeParse({ ...run, keptDatabase: 'averra; drop' }).success).toBe(false)
  })

  it('итог обновления словами: у «не начато» и «откат не удался» — с причиной', () => {
    expect(updateResultText({ result: 'failed', error: 'бэкап перед обновлением не удался' })).toBe(
      'не начато, версия прежняя: бэкап перед обновлением не удался',
    )
    expect(
      updateResultText({
        result: 'rollback-failed',
        error: 'прежняя версия тоже не прошла проверку',
      }),
    ).toBe(
      'не прошло, и откат не удался — нужен человек на сервере: прежняя версия тоже не прошла проверку',
    )
    // У отката причина повторила бы подпись, у удачного её нет
    expect(
      updateResultText({
        result: 'rolled-back',
        error: 'версия 0.7.0 не прошла проверку готовности',
      }),
    ).toBe('не прошло проверку, вернулась прежняя версия')
    expect(updateResultText({ result: 'failed', error: null })).toBe('не начато, версия прежняя')
  })

  it('BackupRun принимает то, что пишет averra.sh, и отвергает чужое', () => {
    expect(BackupRun.safeParse(okBackup(1)).success).toBe(true)
    expect(BackupRun.safeParse({ ...okBackup(1), startedAt: '2026-10-16T03:30:00Z' }).success).toBe(
      true,
    )
    expect(BackupRun.safeParse({ ...okBackup(1), name: '../etc' }).success).toBe(false)
    expect(BackupRun.safeParse({ ...okBackup(1), remote: 'maybe' }).success).toBe(false)
    expect(BackupRun.safeParse({ ...okBackup(1), error: 'x'.repeat(501) }).success).toBe(false)
  })
})
