// @vitest-environment happy-dom
import {
  type InstallationStatus,
  NO_RELEASE_STATE,
  type ReleaseState,
  UPDATE_START_TIMEOUT_MS,
  type UpdateRun,
} from '@averra/schema'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '../test/render-with-router'
import { UpdateSection } from './UpdateSection'

// Раздел «Обновление» экрана «Состояние установки»: что видит владелец до, во время и после
// обновления. Запрос заявки — подделка fetch: проверяется, что уходит и что видно в ответ

beforeAll(() => {
  // happy-dom без showModal: окно подтверждения открывается атрибутом open, как у браузера
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const now = new Date('2026-10-27T12:00:00.000Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

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
  latest: {
    version: '0.7.0',
    publishedAt: '2026-10-20T10:00:00Z',
    breaking: false,
    releases: 1,
    notes: 'Features\n\n• <script>alert(1)</script> обновление из админки',
  },
  available: '0.7.0',
}

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

const render = (data: InstallationStatus, options: { offline?: boolean; loaded?: string } = {}) =>
  renderWithRouter(
    <UpdateSection
      status={data}
      now={now}
      loadedVersion={options.loaded ?? data.version}
      offline={options.offline ?? false}
    />,
  )

describe('раздел «Обновление»', () => {
  it('установлена и доступна, заметки — текстом, а не разметкой', async () => {
    await render(status())
    const section = screen.getByRole('region', { name: 'Обновление' })
    expect(section.textContent).toContain('Установлена 0.6.0 · доступна 0.7.0')
    expect(section.textContent).toContain('Последняя проверка новых версий')
    const notes = within(section).getByRole('region', { name: /Что нового в 0\.7\.0/ })
    expect(notes.textContent).toContain('<script>alert(1)</script>')
    expect(notes.querySelector('script')).toBeNull()
    expect(screen.getByRole('button', { name: 'Обновить до 0.7.0' })).toBeTruthy()
  })

  it('«Обновить» — подтверждение с последствиями, потом заявка с версией', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ version: '0.7.0', requestedAt: now.toISOString() }, { status: 202 }),
    )
    vi.stubGlobal('fetch', fetch)
    await render(status())
    await userEvent.click(screen.getByRole('button', { name: 'Обновить до 0.7.0' }))
    const dialog = screen.getByRole('dialog', { name: 'Обновить до 0.7.0?' })
    // Порядок — как у сервера: сначала загрузка, потом бэкап
    expect(dialog.textContent).toContain(
      'скачает новую версию, затем сделает бэкап базы и медиатеки',
    )
    expect(dialog.textContent).toContain('недоступны минуту-две')
    expect(dialog.textContent).toContain('вернёт прежнюю (0.6.0)')
    // Ничего не отправлено, пока владелец не подтвердил
    expect(fetch).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Обновить до 0.7.0' }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toContain('/api/status/update')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ version: '0.7.0' })
  })

  it('отказ API — причина в окне, окно не закрывается', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'conflict', message: 'Уже идёт обновление до 0.7.0' } },
          { status: 409 },
        ),
      ),
    )
    await render(status())
    await userEvent.click(screen.getByRole('button', { name: 'Обновить до 0.7.0' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Обновить до 0.7.0' }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Заявка не отправлена: Уже идёт обновление до 0.7.0',
    )
  })

  it('идёт обновление — шаги, кнопки нет; API перезапускается — ждём, а не ошибка', async () => {
    await render(status({ update: run({ step: 'migrate' }) }), { offline: true })
    expect(screen.queryByRole('button', { name: /Обновить до/ })).toBeNull()
    expect(screen.getByText('Идёт обновление до 0.7.0')).toBeTruthy()
    expect(screen.getByText(/Админка ждёт, пока API перезапустится/)).toBeTruthy()
    const steps = screen.getByRole('list', { name: 'Шаги обновления' })
    const current = within(steps)
      .getAllByRole('listitem')
      .find((item) => item.getAttribute('aria-current') === 'step')
    expect(current?.textContent).toContain('Запуск и миграции базы')
    expect(current?.textContent).toContain('идёт')
  })

  it('обновлено — итог и «Обновить страницу», если админка тоже новая', async () => {
    await render(
      status({
        version: '0.7.0',
        release: { ...ready, available: null },
        update: run({ result: 'updated', step: 'verify', finishedAt: ago(30_000) }),
      }),
      { loaded: '0.6.0' },
    )
    expect(screen.getByText('Обновлено до 0.7.0')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Обновить страницу' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Обновление' }).textContent).toContain(
      'это последняя версия',
    )
  })

  it('откат — что случилось, на каком шаге и что делать; повторить ту же версию нельзя', async () => {
    await render(
      status({
        update: run({
          result: 'rolled-back',
          step: 'rollback',
          failedStep: 'migrate',
          finishedAt: ago(30_000),
        }),
      }),
    )
    expect(
      screen.getByText('Обновление до 0.7.0 не прошло — работает прежняя версия 0.6.0'),
    ).toBeTruthy()
    expect(screen.getByText(/Сообщите студии/)).toBeTruthy()
    const steps = within(screen.getByRole('list', { name: 'Шаги обновления' })).getAllByRole(
      'listitem',
    )
    expect(steps[2]?.textContent).toContain('Запуск и миграции базы')
    expect(steps[2]?.textContent).toContain('не прошло')
    expect(steps[3]?.textContent).toContain('не начиналось')
    // Та же версия — без кнопки, с объяснением; доступная версия видна
    expect(screen.queryByRole('button', { name: /Обновить до/ })).toBeNull()
    expect(screen.getByText(/уже не прошло и откатилось/)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Обновление' }).textContent).toContain(
      'Установлена 0.6.0 · доступна 0.7.0',
    )
  })

  it('нет хостовой части (разработка) — подсказка вместо кнопки', async () => {
    await render(status({ version: 'dev', release: NO_RELEASE_STATE }))
    expect(screen.queryByRole('button', { name: /Обновить до/ })).toBeNull()
    expect(screen.getByText(/работает только на сервере, установленном install\.sh/)).toBeTruthy()
  })

  it('не удалось проверить — причина и время', async () => {
    await render(
      status({
        release: {
          ...ready,
          check: {
            ...(ready.check as NonNullable<ReleaseState['check']>),
            ok: false,
            error: 'нет сети',
          },
        },
      }),
    )
    const text = screen.getByText(/Проверка новых версий не удалась/).textContent
    expect(text).toContain('нет сети')
    // Причина не повторяет «не удалось» после «не удалось проверить»
    expect(text).not.toContain('Не удалось проверить')
  })

  it('проверка выключена (UPDATE_SOURCE=off) — не «не удалось», а настройка', async () => {
    await render(
      status({
        release: {
          ...ready,
          latest: null,
          available: null,
          check: {
            ...(ready.check as NonNullable<ReleaseState['check']>),
            ok: false,
            error: 'проверка новых версий выключена (UPDATE_SOURCE=off)',
          },
        },
      }),
    )
    expect(screen.queryByText(/не удалась/)).toBeNull()
    expect(screen.getByText(/Проверка новых версий выключена на сервере/)).toBeTruthy()
  })

  it('отклонённая заявка — причина с большой буквы; не забранная — предупреждение', async () => {
    await render(
      status({
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
      }),
    )
    expect(screen.getByText(/^Заявка не по формату\. Версия прежняя/)).toBeTruthy()
    cleanup()
    await render(
      status({
        release: {
          ...ready,
          pending: { version: '0.7.0', requestedAt: ago(UPDATE_START_TIMEOUT_MS + 60_000) },
        },
      }),
    )
    expect(screen.getByText('Заявка не дошла до сервера')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Обновить до 0.7.0' })).toBeTruthy()
  })

  it('ломающий релиз — без кнопки, с объяснением', async () => {
    await render(
      status({
        release: {
          ...ready,
          latest: { ...(ready.latest as NonNullable<ReleaseState['latest']>), breaking: true },
        },
      }),
    )
    expect(screen.queryByRole('button', { name: /Обновить до/ })).toBeNull()
    expect(screen.getByText(/требует шага на сервере/)).toBeTruthy()
    // Кнопки нет, а доступная версия — в строке версий, как и заметки к ней
    expect(screen.getByRole('region', { name: 'Обновление' }).textContent).toContain(
      'Установлена 0.6.0 · доступна 0.7.0',
    )
  })

  it('заметки за несколько пропущенных версий — заголовок говорит, с какой', async () => {
    await render(
      status({
        release: {
          ...ready,
          latest: { ...(ready.latest as NonNullable<ReleaseState['latest']>), releases: 3 },
        },
      }),
    )
    expect(
      screen.getByRole('region', { name: /^Что нового после 0\.6\.0 \(до 0\.7\.0\)/ }),
    ).toBeTruthy()
  })
})
