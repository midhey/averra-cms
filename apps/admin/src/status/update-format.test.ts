import {
  type InstallationStatus,
  NO_RELEASE_STATE,
  type ReleaseState,
  UPDATE_START_TIMEOUT_MS,
  type UpdateRun,
} from '@averra/schema'
import { describe, expect, it } from 'vitest'
import { checkTurnedOff, shouldPoll, updateOutcome, updateSteps, updateView } from './update-format'

const now = new Date('2026-10-27T12:00:00.000Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

const run = (overrides: Partial<UpdateRun> = {}): UpdateRun => ({
  from: '0.6.0',
  to: '0.7.0',
  startedAt: ago(60_000),
  finishedAt: null,
  result: 'in-progress',
  step: 'backup',
  failedStep: null,
  dbRestored: false,
  keptDatabase: null,
  error: null,
  ...overrides,
})

const ready: ReleaseState = {
  ...NO_RELEASE_STATE,
  mode: 'ready',
  check: {
    checkedAt: ago(3_600_000),
    current: '0.6.0',
    ok: true,
    error: null,
    adminUpdate: true,
    requestsWatched: true,
  },
  latest: { version: '0.7.0', publishedAt: null, breaking: false, releases: 1, notes: 'Новое' },
  available: '0.7.0',
}

function status(overrides: Partial<InstallationStatus> = {}): InstallationStatus {
  return {
    version: '0.6.0',
    checkedAt: now.toISOString(),
    db: { up: true, migrations: 20, serviceDatabases: [] },
    backup: { enabled: true, unreadable: false, last: null, lastOk: null },
    update: null,
    updateUnreadable: false,
    release: ready,
    publish: { enabled: true, last: null, failedSites: 0 },
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

const states = (items: { state: string }[]) => items.map((item) => item.state)

describe('updateSteps', () => {
  it('идёт: пройденные, текущий, впереди — в порядке скрипта', () => {
    expect(states(updateSteps(run({ step: 'pull' })))).toEqual([
      'current',
      'pending',
      'pending',
      'pending',
      'pending',
    ])
    expect(states(updateSteps(run({ step: 'migrate' })))).toEqual([
      'done',
      'done',
      'current',
      'pending',
      'pending',
    ])
  })

  it('обновлено — всё пройдено и «Готово»', () => {
    const steps = updateSteps(run({ result: 'updated', step: 'verify', finishedAt: ago(1000) }))
    expect(states(steps)).toEqual(['done', 'done', 'done', 'done', 'done'])
    expect(steps.at(-1)?.label).toBe('Готово')
  })

  it('откат: проверка не прошла, последний шаг — «Откат на прежнюю версию»', () => {
    const going = updateSteps(run({ step: 'rollback' }))
    expect(states(going)).toEqual(['done', 'done', 'done', 'failed', 'current'])
    expect(going.at(-1)?.label).toBe('Откат на прежнюю версию')
    const done = updateSteps(run({ step: 'rollback', result: 'rolled-back', finishedAt: ago(1) }))
    expect(states(done)).toEqual(['done', 'done', 'done', 'failed', 'done'])
    const broken = updateSteps(
      run({ step: 'rollback', result: 'rollback-failed', finishedAt: ago(1) }),
    )
    expect(broken.at(-1)?.state).toBe('failed')
  })

  it('откат после запуска: не прошёл запуск и миграции, проверка не начиналась', () => {
    const steps = updateSteps(
      run({ step: 'rollback', failedStep: 'migrate', result: 'rolled-back', finishedAt: ago(1) }),
    )
    expect(states(steps)).toEqual(['done', 'done', 'failed', 'skipped', 'done'])
    expect(
      states(updateSteps(run({ step: 'rollback', failedStep: 'verify', finishedAt: null }))),
    ).toEqual(['done', 'done', 'done', 'failed', 'current'])
  })

  it('не началось (образы не скачались) — тот шаг не прошёл, остальные уже не начнутся', () => {
    const steps = updateSteps(run({ step: 'pull', result: 'failed', finishedAt: ago(1) }))
    expect(states(steps)).toEqual(['failed', 'skipped', 'skipped', 'skipped', 'skipped'])
  })

  it('заявка ещё ждёт сервер — всё впереди', () => {
    expect(states(updateSteps(null))).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ])
  })
})

describe('updateOutcome', () => {
  it('откат — что случилось и что делать, без кодов', () => {
    const outcome = updateOutcome(
      run({ result: 'rolled-back', step: 'rollback', dbRestored: true, finishedAt: ago(1) }),
    )
    expect(outcome?.tone).toBe('warning')
    expect(outcome?.title).toBe('Обновление до 0.7.0 не прошло — работает прежняя версия 0.6.0')
    expect(outcome?.text).toContain('и базу из бэкапа перед обновлением')
    expect(outcome?.text).toContain('Сообщите студии')
    expect(updateOutcome(run({ result: 'rollback-failed', finishedAt: ago(1) }))?.tone).toBe(
      'danger',
    )
    expect(
      updateOutcome(
        run({ result: 'failed', error: 'образы новой версии не скачались', finishedAt: ago(1) }),
      )?.text,
    ).toBe(
      'Образы новой версии не скачались. Версия прежняя, ничего не менялось — можно повторить позже.',
    )
    expect(updateOutcome(run())).toBeNull()
  })

  it('откат, а почему кнопки на ту же версию нет, сказано рядом — без повтора', () => {
    const rolled = run({ result: 'rolled-back', step: 'rollback', finishedAt: ago(1) })
    expect(updateOutcome(rolled)?.text).toContain('Повторить из админки можно будет')
    expect(updateOutcome(rolled, true)?.text).not.toContain('Повторить')
    expect(updateOutcome(rolled, true)?.text).toContain('Сообщите студии')
  })
})

describe('updateView', () => {
  it('доступна новее — кнопка; идёт обновление — нет кнопки, есть шаги, опрос', () => {
    expect(updateView(status(), now)).toMatchObject({
      activity: 'idle',
      canUpdate: '0.7.0',
      steps: null,
      outcome: null,
    })
    expect(shouldPoll(status(), now)).toBe(false)
    const running = status({ update: run() })
    expect(updateView(running, now)).toMatchObject({
      activity: 'running',
      target: '0.7.0',
      canUpdate: null,
    })
    expect(updateView(running, now).steps).toHaveLength(5)
    expect(shouldPoll(running, now)).toBe(true)
  })

  it('заявка лежит — «отправлена», шаги впереди, опрос', () => {
    const queued = status({
      release: { ...ready, pending: { version: '0.7.0', requestedAt: ago(1000) } },
    })
    const view = updateView(queued, now)
    expect(view).toMatchObject({ activity: 'queued', target: '0.7.0', canUpdate: null })
    expect(states(view.steps ?? [])).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ])
    expect(shouldPoll(queued, now)).toBe(true)
  })

  it('кончилось — итог неделю, шаги час; сервер отклонил заявку — причина', () => {
    const fresh = status({
      version: '0.7.0',
      release: { ...ready, available: null },
      update: run({ result: 'updated', step: 'verify', finishedAt: ago(60_000) }),
    })
    expect(updateView(fresh, now)).toMatchObject({
      activity: 'idle',
      outcome: { tone: 'success', title: 'Обновлено до 0.7.0' },
      canUpdate: null,
    })
    expect(updateView(fresh, now).steps).not.toBeNull()
    const old = status({
      update: run({
        result: 'updated',
        startedAt: ago(9 * 86_400_000),
        finishedAt: ago(8 * 86_400_000),
      }),
    })
    expect(updateView(old, now)).toMatchObject({ outcome: null, steps: null, canUpdate: '0.7.0' })

    const rejected = status({
      release: {
        ...ready,
        request: {
          at: ago(1000),
          version: null,
          requestedAt: null,
          result: 'rejected',
          error: 'заявка не по формату',
        },
      },
    })
    // Причина с хоста — со строчной: на экране она начинает предложение
    expect(updateView(rejected, now)).toMatchObject({
      rejected: 'Заявка не по формату. Версия прежняя, ничего не менялось.',
      canUpdate: '0.7.0',
    })
  })

  it('перед отказом сервер довёл прерванное обновление — без «ничего не менялось»', () => {
    const requestedAt = ago(120_000)
    const view = updateView(
      status({
        version: '0.7.0',
        release: {
          ...ready,
          available: null,
          request: {
            at: ago(1000),
            version: '0.7.0',
            requestedAt,
            result: 'rejected',
            error: 'версия 0.7.0 уже стоит: до неё довелось прерванное прошлое обновление',
          },
        },
        update: run({
          result: 'updated',
          step: 'verify',
          startedAt: ago(3_600_000),
          finishedAt: ago(60_000),
        }),
      }),
      now,
    )
    expect(view.rejected).toBe(
      'Версия 0.7.0 уже стоит: до неё довелось прерванное прошлое обновление.',
    )
  })

  it('откат на ту же версию — объяснение одно: в блоке, а не ещё и в итоге', () => {
    const view = updateView(
      status({ update: run({ result: 'rolled-back', step: 'rollback', finishedAt: ago(60_000) }) }),
      now,
    )
    expect(view.blocked).toContain('уже не прошло и откатилось')
    expect(view.outcome?.text).not.toContain('Повторить')
  })

  it('заявку сервер не забрал за 10 минут — предупреждение, кнопка вернулась, опроса нет', () => {
    const stale = status({
      release: {
        ...ready,
        pending: { version: '0.7.0', requestedAt: ago(UPDATE_START_TIMEOUT_MS + 60_000) },
      },
    })
    const view = updateView(stale, now)
    expect(view.activity).toBe('idle')
    expect(view.stale).toContain('Сервер не забрал заявку на обновление до 0.7.0 за 10 минут')
    expect(view.canUpdate).toBe('0.7.0')
    expect(shouldPoll(stale, now)).toBe(false)
  })

  it('ломающий релиз или неудачный откат — кнопки нет, объяснение есть', () => {
    const breaking = status({
      release: {
        ...ready,
        latest: { ...(ready.latest as NonNullable<ReleaseState['latest']>), breaking: true },
      },
    })
    expect(updateView(breaking, now)).toMatchObject({ canUpdate: null })
    expect(updateView(breaking, now).blocked).toContain('требует шага на сервере')
    const failed = status({
      update: run({ result: 'rollback-failed', step: 'rollback', finishedAt: ago(60_000) }),
    })
    expect(updateView(failed, now)).toMatchObject({
      canUpdate: null,
      outcome: { tone: 'danger' },
    })
    expect(updateView(failed, now).blocked).toContain('неудачным откатом')
  })

  it('откат обновления до этой же версии — кнопки нет до следующей версии', () => {
    const rolledBack = run({ result: 'rolled-back', step: 'rollback', finishedAt: ago(60_000) })
    const same = updateView(status({ update: rolledBack }), now)
    expect(same).toMatchObject({ canUpdate: null, outcome: { tone: 'warning' } })
    expect(same.blocked).toContain('Обновление до 0.7.0 уже не прошло и откатилось')
    // Вышла следующая версия — кнопка вернулась
    const next = status({
      update: rolledBack,
      release: {
        ...ready,
        latest: { ...(ready.latest as NonNullable<ReleaseState['latest']>), version: '0.7.1' },
        available: '0.7.1',
      },
    })
    expect(updateView(next, now)).toMatchObject({ canUpdate: '0.7.1', blocked: null })
  })

  it('UPDATE_SOURCE=off — не сбой, а настройка', () => {
    const check = ready.check as NonNullable<ReleaseState['check']>
    expect(
      checkTurnedOff({
        ...check,
        ok: false,
        error: 'проверка новых версий выключена (UPDATE_SOURCE=off)',
      }),
    ).toBe(true)
    expect(checkTurnedOff({ ...check, ok: false, error: 'нет сети' })).toBe(false)
    expect(checkTurnedOff(check)).toBe(false)
  })

  it('нет хостовой части или выключено — кнопки нет', () => {
    for (const mode of ['no-host', 'disabled', 'no-watcher', 'no-requests'] as const) {
      expect(updateView(status({ release: { ...ready, mode } }), now).canUpdate).toBeNull()
    }
  })
})
