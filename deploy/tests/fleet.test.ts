import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type InstallationStatus, NO_RELEASE_STATE } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import {
  describeOutcome,
  type Exec,
  type ExecResult,
  fleetStatus,
  fleetUpdate,
  main,
  parseServers,
  serversFile,
  sshArgs,
} from '../src/fleet'
import { tempDir } from './bash'

// pnpm fleet: список серверов, состояние всех и обновление по очереди. ssh подменён: план и
// разбор ответов проверяются без сети

const now = new Date('2026-10-16T12:00:00Z')

function status(overrides: Partial<InstallationStatus> = {}): InstallationStatus {
  return {
    version: '0.7.0',
    checkedAt: now.toISOString(),
    db: { up: true, migrations: 15, serviceDatabases: [] },
    backup: {
      enabled: true,
      unreadable: false,
      last: null,
      lastOk: {
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
      },
    },
    update: null,
    updateUnreadable: false,
    release: NO_RELEASE_STATE,
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

/** ssh, который отвечает по хосту и запоминает вызовы */
function fakeSsh(answers: Record<string, ExecResult>) {
  const calls: string[][] = []
  const exec: Exec = async (command, args, options) => {
    calls.push([command, ...args])
    const host = args.at(-2) ?? ''
    const answer = answers[host] ?? {
      code: 255,
      stdout: '',
      stderr: `ssh: connect to host ${host}: timed out`,
    }
    options?.stream?.(`вывод ${host}`)
    return answer
  }
  return { exec, calls }
}

const ok = (body: unknown): ExecResult => ({
  code: 0,
  stdout: `${JSON.stringify(body)}\n`,
  stderr: '',
})

describe('список серверов', () => {
  it('имя, адрес, порт и папка; комментарии и пустые строки пропускаются', () => {
    expect(
      parseServers(
        '# установки студии\n\nremont root@203.0.113.10\nokna deploy@okna.example.ru port=2222 dir=/srv/averra/ # второй\n',
      ),
    ).toEqual([
      { name: 'remont', target: 'root@203.0.113.10', dir: '/opt/averra' },
      { name: 'okna', target: 'deploy@okna.example.ru', port: 2222, dir: '/srv/averra' },
    ])
  })

  it('кривые строки — ошибка с номером, а не тихий пропуск', () => {
    expect(() => parseServers('remont root@host\nremont root@other')).toThrow(
      'строка 2: имя «remont» уже есть',
    )
    expect(() => parseServers('x -oProxyCommand=evil')).toThrow('не пользователь@хост')
    expect(() => parseServers('x root@host port=99999')).toThrow(
      'строка 1: непонятное «port=99999»',
    )
    expect(() => parseServers('x root@host dir=../etc')).toThrow('непонятное')
    expect(() => parseServers('Плохое root@host')).toThrow('имя «Плохое»')
  })

  it('ssh только по ключам: BatchMode, таймаут, адрес после «--»', () => {
    expect(sshArgs({ name: 'x', target: 'root@h', port: 2222, dir: '/opt/averra' }, 'cmd')).toEqual(
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-p', '2222', '--', 'root@h', 'cmd'],
    )
  })
})

describe('pnpm fleet status', () => {
  const servers = parseServers('a root@a\nb root@b\nc root@c\nd root@d')

  it('таблица по ответам; проблемы, лежащий API и недоступный сервер дают код 1', async () => {
    const { exec, calls } = fakeSsh({
      'root@a': ok(status()),
      'root@b': ok(
        status({ problems: [{ code: 'mail_failed', message: 'Писем не ушло за неделю: 2' }] }),
      ),
      'root@c': {
        code: 1,
        stdout: '{"apiDown":true,"configuredVersion":"0.6.0","backupLast":null}\n',
        stderr: '',
      },
    })
    const result = await fleetStatus(servers, exec, now)
    expect(calls[0]).toEqual([
      'ssh',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '--',
      'root@a',
      'sudo -n /opt/averra/averra.sh status --json',
    ])
    expect(result.items.map((item) => item.kind)).toEqual(['ok', 'ok', 'api-down', 'unreachable'])
    expect(result.code).toBe(1)
    const lines = result.table.split('\n')
    expect(lines[0]).toMatch(/^Сервер\s+Версия\s+База\s+Бэкап\s+Почта\s+Проблемы$/)
    expect(lines[1]).toMatch(/^a\s+0\.7\.0\s+ок\s+ок, 8 ч назад\s+ок\s+—$/)
    expect(lines[2]).toContain('Писем не ушло за неделю: 2')
    expect(lines[3]).toMatch(/^c\s+0\.6\.0\s+\?\s+—\s+\?\s+API не отвечает$/)
    expect(lines[4]).toContain('SSH: ssh: connect to host root@d: timed out')
  })

  it('API лежит из-за обновления: идёт или оборвалось — видно в таблице', async () => {
    const down = (update?: string) => ({
      code: 1,
      stdout: `${JSON.stringify({ apiDown: true, configuredVersion: '0.7.0', backupLast: null, updateLast: null, ...(update ? { update } : {}) })}\n`,
      stderr: '',
    })
    const { exec } = fakeSsh({
      'root@a': down('running'),
      'root@b': down('interrupted'),
      // Прежний averra.sh этого поля не знает
      'root@c': down(),
      'root@d': down('что-то новое'),
    })
    const result = await fleetStatus(servers, exec, now)
    expect(result.items.map((item) => item.kind)).toEqual([
      'api-down',
      'api-down',
      'api-down',
      'api-down',
    ])
    const lines = result.table.split('\n')
    expect(lines[1]).toMatch(/API не отвечает: идёт обновление$/)
    expect(lines[2]).toMatch(/обновление оборвалось — повторите pnpm fleet update$/)
    expect(lines[3]).toMatch(/\sAPI не отвечает$/)
    expect(lines[4]).toMatch(/\sAPI не отвечает$/)
  })

  it('все исправны — код 0', async () => {
    const { exec } = fakeSsh({ 'root@a': ok(status()) })
    expect((await fleetStatus(servers.slice(0, 1), exec, now)).code).toBe(0)
  })

  it('ответ не по схеме — сервер «недоступен» с причиной, а не падение команды', async () => {
    const { exec } = fakeSsh({ 'root@a': ok({ version: 1 }) })
    const result = await fleetStatus(servers.slice(0, 1), exec, now)
    expect(result.items[0]).toMatchObject({
      kind: 'unreachable',
      reason: expect.stringContaining('не по схеме'),
    })
  })
})

describe('pnpm fleet update', () => {
  const servers = parseServers('a root@a\nb root@b\nc root@c')

  it('по очереди; первая ошибка останавливает, остальные не трогаем', async () => {
    const { exec, calls } = fakeSsh({
      'root@a': { code: 0, stdout: '', stderr: '' },
      'root@b': { code: 1, stdout: '', stderr: '' },
      'root@c': { code: 0, stdout: '', stderr: '' },
    })
    const log: string[] = []
    const outcome = await fleetUpdate(servers, '0.7.0', exec, (line) => log.push(line))
    expect(outcome).toEqual({ updated: ['a'], failed: { name: 'b', code: 1 }, skipped: ['c'] })
    expect(calls.map((call) => call.at(-1))).toEqual([
      'sudo -n /opt/averra/averra.sh update --version 0.7.0 --yes',
      'sudo -n /opt/averra/averra.sh update --version 0.7.0 --yes',
    ])
    // Вывод сервера идёт по ходу, с именем сервера
    expect(log).toContain('[a] вывод root@a')
  })

  it('итог словами: оборвавшийся процесс (3) и обрыв SSH (255) — что делать дальше', () => {
    const outcome = (code: number) =>
      describeOutcome({ updated: ['a'], failed: { name: 'b', code }, skipped: ['c'] })
    expect(outcome(3)).toContain(
      'процесс обновления на сервере оборвался — повторите pnpm fleet update',
    )
    expect(outcome(255)).toContain('Обновление на сервере идёт отдельно от SSH и доработает само')
    expect(outcome(255)).toContain('Не трогали: c')
  })

  it('версия проверяется до SSH: она идёт в команду на сервере', async () => {
    const { exec, calls } = fakeSsh({})
    await expect(fleetUpdate(servers, '0.7.0; reboot', exec, () => {})).rejects.toThrow('не версия')
    expect(calls).toEqual([])
  })

  it('список: вне deploy/ по умолчанию, --file — от папки запуска pnpm (INIT_CWD)', async () => {
    const home = tempDir('averra-home')
    expect(serversFile(undefined, {}, home)).toBe(join(home, '.config', 'averra', 'servers.txt'))
    const root = tempDir('averra-repo')
    expect(serversFile('deploy/servers.example.txt', { INIT_CWD: root }, home)).toBe(
      resolve(root, 'deploy/servers.example.txt'),
    )
    expect(serversFile(undefined, { INIT_CWD: root, AVERRA_SERVERS: 'my.txt' }, home)).toBe(
      resolve(root, 'my.txt'),
    )
    // Относительный --file из корня репозитория находит файл, хотя pnpm запускает команду в deploy/
    writeFileSync(join(root, 'servers.txt'), 'a root@a\n')
    const { exec, calls } = fakeSsh({ 'root@a': ok(status()) })
    const code = await main(['status', '--file', 'servers.txt'], exec, () => {}, {
      INIT_CWD: root,
    })
    expect(code).toBe(0)
    expect(calls).toHaveLength(1)
    // Нет файла — в ошибке полный путь
    await expect(
      main(['status'], exec, () => {}, { INIT_CWD: root, AVERRA_SERVERS: 'нет.txt' }),
    ).rejects.toThrow(resolve(root, 'нет.txt'))
  })

  it('main: --only выбирает серверы, код выхода 1 при сбое, неизвестное имя — ошибка', async () => {
    const file = join(tempDir('averra-fleet'), 'servers.txt')
    writeFileSync(file, 'a root@a\nb root@b\nc root@c\n')
    const { exec, calls } = fakeSsh({ 'root@c': { code: 2, stdout: '', stderr: '' } })
    const log: string[] = []
    const code = await main(
      ['update', '--version', '0.7.0', '--only', 'c', '--file', file],
      exec,
      (line) => log.push(line),
    )
    expect(code).toBe(1)
    expect(calls).toHaveLength(1)
    expect(log.join('\n')).toContain('Сломалось на c: откат не удался — нужен человек на сервере')
    await expect(main(['status', '--only', 'z', '--file', file], exec, () => {})).rejects.toThrow(
      'Нет в списке: z',
    )
  })
})
