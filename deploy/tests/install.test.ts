import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bash, pathEntry, posix, tempDir } from './bash'

// Установщик deploy/install.sh без Docker и без настоящего VPS: сухой прогон, разбор флагов,
// .env (секреты, права, повторный запуск) и полный прогон с подделками docker, ss, getent и
// hostname в PATH — они пишут, с чем их позвали. Настоящий Docker и VPS — чек-лист живой проверки
// (документация: Установка и сопровождение → Чек-лист живой проверки)

const script = fileURLToPath(new URL('../install.sh', import.meta.url))
const composeFile = fileURLToPath(new URL('../compose.yaml', import.meta.url))
const externalComposeFile = fileURLToPath(new URL('../compose.external.yaml', import.meta.url))

type Fakes = {
  /** Что отвечает getent ahosts: адреса доменов */
  dns?: Record<string, string>
  /** Адреса сервера (hostname -I) */
  serverIps?: string
  /** Занятые порты (ss) */
  busyPorts?: number[]
  /** docker info падает: нет прав */
  dockerDenied?: boolean
  /** Наш Caddy уже запущен (повторная установка) */
  caddyRunning?: boolean
  /** mv временного .env на место падает: прогон обрывается посреди записи .env */
  failEnvMove?: boolean
  /** docker compose pull падает с этим ответом реестра */
  pullError?: string
  /**
   * Ответ внешней базы на проверку установщика: версия|CREATE на базе|CREATE на public|таблиц в
   * public|есть миграции Averra. По умолчанию — PostgreSQL 18, права есть, база пустая
   */
  dbFacts?: string
  /** Клиент PostgreSQL не вошёл во внешнюю базу: что он напечатал */
  dbError?: string
  /** docker pull образа клиента бэкапов (postgres) падает */
  clientPullFails?: boolean
}

/** Папка с подделками команд: каждая пишет свой вызов (и окружение docker) в журнал */
function fakeBin(root: string, fakes: Fakes) {
  const bin = join(root, 'bin')
  const log = join(root, 'calls.log')
  const chmodLog = join(root, 'chmod.log')
  mkdirSync(bin, { recursive: true })
  const write = (name: string, body: string) => {
    const file = join(bin, name)
    writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`)
    chmodSync(file, 0o755)
  }
  // getent ahosts — как на сервере без своего IPv6 (AI_ADDRCONFIG): только A-записи. AAAA видит
  // dig: так тест ловит чужую AAAA-запись, которую одним getent не увидеть
  const records = Object.entries(fakes.dns ?? {}).map(([domain, ips]) => ({
    domain,
    ips: ips.split(' ').filter(Boolean),
  }))
  const v4 = (ips: string[]) => ips.filter((ip) => !ip.includes(':'))
  const v6 = (ips: string[]) => ips.filter((ip) => ip.includes(':'))
  const getent = records
    .filter(({ ips }) => v4(ips).length > 0)
    .map(
      ({ domain, ips }) =>
        `  ${domain}) printf '%s      STREAM ${domain}\\n' ${v4(ips).join(' ')} ;;`,
    )
  write('getent', `case "$2" in\n${getent.join('\n')}\n  *) exit 2 ;;\nesac`)
  const dig = records.flatMap(({ domain, ips }) => [
    `  "+short A ${domain}") printf '%s\\n' ${v4(ips).join(' ')} ;;`,
    `  "+short AAAA ${domain}") printf '%s\\n' ${v6(ips).join(' ')} ;;`,
  ])
  // Подделка печатает и имя из CNAME: установщик берёт из ответа только адреса
  write('dig', `echo "cname.example.net."\ncase "$*" in\n${dig.join('\n')}\n  *) ;;\nesac`)
  // chmod — настоящий, но вызов записан: права .env видны и на Windows, где NTFS их не держит
  write('chmod', `printf '%s\\n' "$*" >> "${posix(chmodLog)}"\nexec /usr/bin/chmod "$@"`)
  // systemctl — подделка: таймер бэкапов ставится в свою папку теста, а не в /etc/systemd
  // is-enabled и is-active — «да» и без записи: так averra.sh узнаёт, есть ли кому забирать заявки
  write(
    'systemctl',
    `[[ "$1" != is-enabled && "$1" != is-active ]] || exit 0\nprintf '%s\\n' "$*" >> "${posix(join(root, 'systemctl.log'))}"`,
  )
  // chown — подделка: владелец папки заявок (пользователь API) виден и без root
  write('chown', `printf '%s\\n' "$*" >> "${posix(join(root, 'chown.log'))}"`)
  // curl — сети нет: проверка новой версии при установке «не удалась», установка идёт дальше
  write('curl', 'exit 7')
  if (fakes.failEnvMove) {
    write(
      'mv',
      'case "$*" in *"/.env."*) echo "mv: No space left on device" >&2; exit 1 ;; esac\nexec /usr/bin/mv "$@"',
    )
  }
  write('hostname', `echo "${fakes.serverIps ?? '203.0.113.5 10.0.0.2'}"`)
  const busy = (fakes.busyPorts ?? []).map(
    (port) => `*":${port}"*) echo "LISTEN 0 4096 *:${port} *:*" ;;`,
  )
  write('ss', `case "$*" in\n${busy.join('\n')}\n  *) ;;\nesac`)
  write(
    'docker',
    `printf 'docker %s | CMS_USER_PASSWORD=%s\\n' "$*" "\${CMS_USER_PASSWORD:-}" >> "${posix(log)}"
[[ -z "\${AVERRA_DATABASE_URL:-}" ]] || printf '%s\\n' "$*" >> "${posix(join(root, 'db-url-env.log'))}"
case "$*" in
  *" postgres:"*" psql "*)
    printf 'host=%s port=%s user=%s password=%s db=%s sslmode=%s rootcert=%s\\n' "$PGHOST" "$PGPORT" "$PGUSER" "$PGPASSWORD" "$PGDATABASE" "$PGSSLMODE" "$PGSSLROOTCERT" >> "${posix(join(root, 'pg-env.log'))}"
    ${fakes.dbError ? `echo '${fakes.dbError}' >&2; exit 2` : `echo '${fakes.dbFacts ?? '180006|t|t|0|f'}'`} ;;
  "info") ${fakes.dockerDenied ? 'exit 1' : 'exit 0'} ;;
  "compose version") exit 0 ;;
  *" ps --status running -q caddy") ${fakes.caddyRunning ? 'echo abc123' : 'true'} ;;
  *" pull") ${fakes.pullError ? `echo '${fakes.pullError}' >&2; exit 1` : 'exit 0'} ;;
  "pull postgres:"*) ${fakes.clientPullFails ? "echo 'Error response from daemon: Get https://registry-1.docker.io/v2/: timeout' >&2; exit 1" : 'exit 0'} ;;
  *"user-create.js"*) echo "Создан владелец" ;;
  *) exit 0 ;;
esac`,
  )
  return { bin, log, chmodLog }
}

type Run = { status: number | null; stdout: string; stderr: string; output: string }

function install(
  args: string[],
  options: { fakes?: Fakes; env?: Record<string, string>; cwd?: string } = {},
) {
  const root = tempDir()
  const { bin, log, chmodLog } = fakeBin(root, options.fakes ?? {})
  const systemd = join(root, 'systemd')
  mkdirSync(systemd)
  // Подделки — первыми в PATH уже внутри bash: Git Bash на Windows сам ставит /usr/bin впереди
  // унаследованного PATH, и настоящий hostname заслонил бы подделку
  const inBash = 'PATH="$AVERRA_FAKE_BIN:$PATH" exec bash "$@"'
  const result = spawnSync(bash, ['-c', inBash, 'bash', posix(script), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AVERRA_FAKE_BIN: pathEntry(bin),
      AVERRA_SYSTEMD_DIR: posix(systemd),
      ...options.env,
    },
    // Без терминала: установщик ничего не спрашивает
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(options.cwd ? { cwd: options.cwd } : {}),
  })
  const run: Run = {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.stdout + result.stderr,
  }
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '')
  const chmods = () => (existsSync(chmodLog) ? readFileSync(chmodLog, 'utf8') : '')
  const systemctl = () =>
    existsSync(join(root, 'systemctl.log')) ? readFileSync(join(root, 'systemctl.log'), 'utf8') : ''
  const chowns = () =>
    existsSync(join(root, 'chown.log')) ? readFileSync(join(root, 'chown.log'), 'utf8') : ''
  const pgEnv = () =>
    existsSync(join(root, 'pg-env.log')) ? readFileSync(join(root, 'pg-env.log'), 'utf8') : ''
  /** Вызовы docker, которые унаследовали AVERRA_DATABASE_URL (адрес с паролем) */
  const dbUrlEnv = () =>
    existsSync(join(root, 'db-url-env.log'))
      ? readFileSync(join(root, 'db-url-env.log'), 'utf8')
      : ''
  return { ...run, calls, chmods, chowns, systemd, systemctl, pgEnv, dbUrlEnv }
}

const required = [
  '--site-domain',
  'example.ru',
  '--email',
  'studio@example.com',
  '--version',
  '0.6.0',
]

function readEnv(dir: string) {
  const env: Record<string, string> = {}
  for (const line of readFileSync(join(dir, '.env'), 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line)
    if (match?.[1]) env[match[1]] = match[2] ?? ''
  }
  return env
}

describe('флаги', () => {
  it('--help показывает справку', () => {
    const run = install(['--help'])
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('--site-domain <домен>')
    expect(run.stdout).toContain('GHCR_TOKEN')
  })

  it('непонятный аргумент и флаг без значения — ошибка, а не тихий пропуск', () => {
    const unknown = install([...required, '--domen', 'x'])
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain('непонятный аргумент: --domen')
    const empty = install(['--site-domain', '--email', 'a@b.ru'])
    expect(empty.status).toBe(1)
    expect(empty.stderr).toContain('у флага --site-domain нет значения')
  })

  it('без обязательного — понятная ошибка, ничего не спрашивая', () => {
    const run = install(['--email', 'studio@example.com', '--version', '1', '--yes', '--dry-run'])
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('не задан домен сайта: --site-domain')
  })

  it('кривые домен, почта, версия и образ отклоняются: они попадают в Caddyfile и .env', () => {
    const dir = posix(join(tempDir(), 'inst'))
    const cases: [string[], string][] = [
      [['--site-domain', 'Remont.RU'], 'SITE_DOMAIN «Remont.RU» — не домен'],
      [['--site-domain', 'example.ru {'], 'не домен'],
      [['--admin-domain', 'example.ru'], 'домен сайта и админки должны различаться'],
      [['--email', 'нет-почты'], 'не адрес почты'],
      [['--version', '1.0 ; rm -rf /'], 'не тег образа'],
      [['--api-image', 'Registry/IMG'], 'не имя образа'],
      // Название идёт в .env, который читает docker compose: $ и # там меняют значение
      [['--site-name', 'Цены от $100'], 'название сайта «Цены от $100» — одной строкой'],
      [['--site-name', 'Ремонт #1'], 'без кавычек и знаков'],
      [['--site-name', 'Ремонт "Иван"'], 'без кавычек и знаков'],
    ]
    for (const [override, message] of cases) {
      const args = [...required, ...override, '--dir', dir, '--dry-run']
      const run = install(args)
      expect(run.status, override.join(' ')).toBe(1)
      expect(run.stderr).toContain(message)
    }
  })

  it('домен в punycode годится, поддомен админки по умолчанию — admin.<домен>', () => {
    const dir = posix(join(tempDir(), 'inst'))
    const run = install([
      '--site-domain',
      'xn--e1afmkfd.xn--p1ai',
      '--email',
      'a@b.ru',
      '--version',
      '1',
      '--dir',
      dir,
      '--dry-run',
      '--skip-dns-check',
    ])
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('https://admin.xn--e1afmkfd.xn--p1ai')
  })
})

const dnsOk = { 'example.ru': '203.0.113.5', 'admin.example.ru': '203.0.113.5' }

describe('сухой прогон', () => {
  it('показывает план, проходит проверки и ничего не пишет и не запускает', () => {
    const dir = join(tempDir(), 'inst')
    const run = install([...required, '--dir', posix(dir), '--dry-run'], { fakes: { dns: dnsOk } })
    expect(run.status, run.output).toBe(0)
    expect(run.stdout).toContain('Сухой прогон: ничего не меняется.')
    expect(run.stdout).toContain(
      'Новые секреты:     POSTGRES_PASSWORD AUTH_SECRET MAIL_ENCRYPTION_KEY BACKUP_PASSPHRASE',
    )
    expect(run.stdout).toContain('ghcr.io/midhey/averra-api:0.6.0')
    expect(run.stdout).toContain('всё в порядке')
    expect(existsSync(dir)).toBe(false)
    // Docker только спрошен, что он есть и отвечает: ни pull, ни up, ни exec
    expect(run.calls().replace(/ \| .*$/gm, '')).toBe('docker compose version\ndocker info\n')
  })

  it('показывает все проблемы окружения сразу и выходит с ошибкой', () => {
    const dir = join(tempDir(), 'inst')
    const run = install([...required, '--dir', posix(dir), '--dry-run'], {
      fakes: {
        dns: { 'example.ru': '198.51.100.7' },
        busyPorts: [443],
        dockerDenied: true,
      },
    })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('не пройдёт: Docker не отвечает или нет прав')
    expect(run.stdout).toContain('не пройдёт: порты заняты: 443')
    expect(run.stdout).toContain('не пройдёт: домен example.ru указывает на 198.51.100.7')
    expect(run.stdout).toContain('не пройдёт: домен admin.example.ru не находится в DNS')
    expect(run.stdout).toContain('Проблем: 4')
    expect(existsSync(dir)).toBe(false)
    expect(run.calls()).not.toMatch(/pull|up -d|exec/)
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'без прав на папку установки — «запустите через sudo», а не Permission denied',
    () => {
      const parent = tempDir()
      chmodSync(parent, 0o555)
      try {
        const dir = posix(join(parent, 'inst'))
        const dry = install([...required, '--dir', dir, '--dry-run', '--skip-dns-check'])
        expect(dry.status).toBe(1)
        expect(dry.stdout).toContain(`нет прав на запись в ${dir}: запустите через sudo`)
        const run = install([...required, '--dir', dir, '--env-only'])
        expect(run.status).toBe(1)
        expect(run.stderr).toContain('запустите через sudo')
        expect(run.stderr).not.toContain('Permission denied')
      } finally {
        chmodSync(parent, 0o755)
      }
    },
  )
})

describe('.env установки', () => {
  it('секреты нужного вида, права 600, compose.yaml рядом', () => {
    const dir = join(tempDir(), 'inst')
    const run = install([...required, '--dir', posix(dir), '--env-only'])
    expect(run.status, run.output).toBe(0)
    const env = readEnv(dir)
    expect(env).toMatchObject({
      AVERRA_VERSION: '0.6.0',
      SITE_DOMAIN: 'example.ru',
      ADMIN_DOMAIN: 'admin.example.ru',
      ACME_EMAIL: 'studio@example.com',
      OWNER_EMAIL: '',
      // Название сайта для первого запуска API: по умолчанию — домен сайта
      SITE_NAME: 'example.ru',
    })
    expect(env).not.toHaveProperty('SITE_ID')
    // Пароль Postgres — hex (стоит в DATABASE_URL), ключи — 32 байта в base64
    expect(env.POSTGRES_PASSWORD).toMatch(/^[0-9a-f]{48}$/)
    expect(Buffer.from(env.AUTH_SECRET ?? '', 'base64')).toHaveLength(32)
    expect(Buffer.from(env.MAIL_ENCRYPTION_KEY ?? '', 'base64')).toHaveLength(32)
    expect(env.AUTH_SECRET).not.toBe(env.MAIL_ENCRYPTION_KEY)
    expect(readFileSync(join(dir, 'compose.yaml'), 'utf8')).toBe(readFileSync(composeFile, 'utf8'))
    // Права: на всех системах — что установщик сам выставил 600 (на NTFS режим файла не держится,
    // поэтому вызов chmod записан подделкой), а на Linux — ещё и настоящий режим файла
    expect(run.chmods()).toMatch(/^600 \S+\/\.env\.\w+$/m)
    const notPrivate = run
      .chmods()
      .trim()
      .split('\n')
      .filter((line) => !line.startsWith('600 '))
    // Кроме .env — только папка заявок (700): в неё пишет один API
    expect(notPrivate).toEqual([expect.stringMatching(/^700 \S+\/requests$/)])
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600)
    }
    // Секреты в вывод не попадают — только их имена
    expect(run.output).not.toContain(env.AUTH_SECRET)
    expect(run.output).not.toContain(env.POSTGRES_PASSWORD)
  })

  it('прогон оборвался посреди записи .env — временного файла с секретами не остаётся', () => {
    const dir = join(tempDir(), 'inst')
    const run = install([...required, '--dir', posix(dir), '--env-only'], {
      fakes: { failEnvMove: true },
    })
    expect(run.status).not.toBe(0)
    expect(readdirSync(dir).filter((name) => name.startsWith('.env'))).toEqual([])
  })

  it('повторный запуск не меняет секреты, а новые домены и версию записывает; свои строки остаются', () => {
    const dir = join(tempDir(), 'inst')
    expect(install([...required, '--dir', posix(dir), '--env-only']).status).toBe(0)
    const before = readEnv(dir)
    writeFileSync(
      join(dir, '.env'),
      `${readFileSync(join(dir, '.env'), 'utf8')}SMTP_HOST=smtp.yandex.ru\n`,
    )

    const again = install([
      '--dir',
      posix(dir),
      '--env-only',
      '--yes',
      '--site-domain',
      'new.ru',
      '--version',
      '0.7.0',
    ])
    expect(again.status, again.output).toBe(0)
    expect(again.stdout).toContain('не менялись')
    const after = readEnv(dir)
    for (const key of [
      'POSTGRES_PASSWORD',
      'AUTH_SECRET',
      'MAIL_ENCRYPTION_KEY',
      'BACKUP_PASSPHRASE',
    ]) {
      expect(after[key], key).toBe(before[key])
    }
    expect(after).toMatchObject({
      SITE_DOMAIN: 'new.ru',
      ADMIN_DOMAIN: 'admin.example.ru',
      AVERRA_VERSION: '0.7.0',
      ACME_EMAIL: 'studio@example.com',
      SMTP_HOST: 'smtp.yandex.ru',
    })
    // Свои строки не задваиваются, заголовок — один
    const text = readFileSync(join(dir, '.env'), 'utf8')
    expect(text.match(/SMTP_HOST=/g)).toHaveLength(1)
    expect(text.match(/^# Установка Averra/gm)).toHaveLength(1)
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600)
    }
  })

  it('название сайта: из --site-name, потом из .env; SITE_ID прежней версии остаётся своей строкой', () => {
    const dir = join(tempDir(), 'inst')
    const first = install([
      ...required,
      '--dir',
      posix(dir),
      '--env-only',
      '--site-name',
      'Ремонт квартир',
    ])
    expect(first.status, first.output).toBe(0)
    expect(readEnv(dir).SITE_NAME).toBe('Ремонт квартир')
    // Установка прежней версии: в .env есть SITE_ID, его читал прежний Caddyfile
    const old = 'c6026fd5-5af8-4af9-a36e-1e08b05210a8'
    writeFileSync(join(dir, '.env'), `${readFileSync(join(dir, '.env'), 'utf8')}SITE_ID=${old}\n`)

    const again = install(['--dir', posix(dir), '--env-only', '--yes'])
    expect(again.status, again.output).toBe(0)
    // Новая версия SITE_ID не ведёт, но и не стирает: откат обновления вернёт прежний Caddyfile
    expect(readEnv(dir)).toMatchObject({ SITE_NAME: 'Ремонт квартир', SITE_ID: old })
    expect(readFileSync(join(dir, '.env'), 'utf8').match(/^SITE_ID=/gm)).toHaveLength(1)
  })

  it('без флагов повторный запуск берёт всё из .env', () => {
    const dir = join(tempDir(), 'inst')
    expect(install([...required, '--dir', posix(dir), '--env-only']).status).toBe(0)
    const run = install(['--dir', posix(dir), '--dry-run', '--yes'], { fakes: { dns: dnsOk } })
    expect(run.status, run.output).toBe(0)
    expect(run.stdout).toContain('https://example.ru')
    expect(run.stdout).toContain('Новые секреты:     нет (берутся из .env)')
  })
})

describe('полная установка (подделки docker и сети)', () => {
  it('поднимает базу и API, ждёт готовности, создаёт владельца и сайт, потом Caddy', () => {
    const dir = join(tempDir(), 'inst')
    const run = install([...required, '--dir', posix(dir), '--yes'], {
      fakes: { dns: dnsOk },
      env: {
        AVERRA_OWNER_PASSWORD: 'очень-секретный-пароль',
        GHCR_USER: 'studio',
        GHCR_TOKEN: 'ghp_тестовый',
      },
    })
    expect(run.status, run.output).toBe(0)
    const calls = run.calls().split('\n').filter(Boolean)
    const steps = calls.map((line) =>
      line.replace(/ \| .*$/, '').replace(/--project-directory \S+ /, ''),
    )
    expect(steps).toEqual([
      'docker compose version',
      'docker info',
      // Своего Caddy ещё нет (нет compose.yaml) — порты проверяются честно, без docker compose ps
      'docker login ghcr.io -u studio --password-stdin',
      'docker compose pull',
      'docker compose up -d postgres api',
      expect.stringMatching(/^docker compose exec -T api node -e fetch/),
      'docker compose exec -T -e CMS_USER_PASSWORD api node dist/server/user-create.js --email studio@example.com --name Владелец --if-missing',
      // Сайт установки создаёт сам API при первом запуске: отдельной команды и SITE_ID нет
      'docker compose up -d',
    ])
    // Пароль владельца и токен GHCR — не в аргументах команд: пароль приходит переменной окружения
    expect(run.calls()).not.toMatch(/docker [^|]*очень-секретный-пароль/)
    expect(run.calls()).not.toContain('ghp_тестовый')
    expect(calls.find((line) => line.includes('user-create'))).toContain(
      'CMS_USER_PASSWORD=очень-секретный-пароль',
    )
    expect(readEnv(dir)).toMatchObject({
      OWNER_EMAIL: 'studio@example.com',
      SITE_NAME: 'example.ru',
    })
    expect(readEnv(dir)).not.toHaveProperty('SITE_ID')
    expect(run.stdout).toContain('Админка: https://admin.example.ru')
    // Скрипт управления и папки бэкапов и состояния — в папке установки, таймер бэкапов — в systemd
    expect(readFileSync(join(dir, 'averra.sh'), 'utf8')).toBe(
      readFileSync(fileURLToPath(new URL('../averra.sh', import.meta.url)), 'utf8'),
    )
    expect(existsSync(join(dir, 'backups'))).toBe(true)
    expect(existsSync(join(dir, 'state'))).toBe(true)
    // Папка заявок из админки — до запуска API и пользователю API (node, uid 1000)
    expect(existsSync(join(dir, 'requests'))).toBe(true)
    expect(run.chowns()).toContain(`1000:1000 ${posix(dir)}/requests\n`)
    expect(run.chmods()).toContain(`700 ${posix(dir)}/requests`)
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'averra.sh')).mode & 0o777).toBe(0o700)
      expect(statSync(join(dir, 'backups')).mode & 0o777).toBe(0o700)
      expect(statSync(join(dir, 'requests')).mode & 0o777).toBe(0o700)
    }
    // Службы ставит сам averra.sh (install-units): бэкап с проверкой версии и заявки из админки
    // Путь — как его видит bash averra.sh (в Git Bash временная папка — /tmp/…)
    const service = readFileSync(join(run.systemd, 'averra-backup.service'), 'utf8')
    expect(service).toMatch(/^ExecStart=\S*\/inst\/averra\.sh backup --kind scheduled$/m)
    expect(service).toMatch(/^ExecStartPre=-\S*\/inst\/averra\.sh check-update$/m)
    expect(readFileSync(join(run.systemd, 'averra-backup.timer'), 'utf8')).toContain(
      'Persistent=true',
    )
    expect(readFileSync(join(run.systemd, 'averra-update-request.path'), 'utf8')).toMatch(
      /^PathExists=\S*\/inst\/requests\/update\.json$/m,
    )
    expect(readFileSync(join(run.systemd, 'averra-check-update.path'), 'utf8')).toMatch(
      /^PathExists=\S*\/inst\/requests\/check-update\.json$/m,
    )
    expect(run.systemctl()).toBe(
      'daemon-reload\nenable --now averra-backup.timer\nenable --now averra-check-update.path\nenable averra-update-resume.service\nenable --now averra-update-request.path\n',
    )
    // Сети нет — проверка версии «не удалась», это видно админке, а установка прошла
    expect(
      JSON.parse(readFileSync(join(dir, 'state', 'release-check.json'), 'utf8')),
    ).toMatchObject({ ok: false, adminUpdate: true, requestsWatched: true })
    expect(readEnv(dir).BACKUP_PASSPHRASE).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(run.output).toContain('Сохраните BACKUP_PASSPHRASE')
  })

  it('--ghcr-user: токен из окружения через stdin, без терминала и токена — отказ до pull', () => {
    const dir = posix(join(tempDir(), 'inst'))
    const withToken = install([...required, '--dir', dir, '--yes', '--ghcr-user', 'studio'], {
      fakes: { dns: dnsOk },
      env: { AVERRA_OWNER_PASSWORD: 'пароль-владельца', GHCR_TOKEN: 'ghp_из_окружения' },
    })
    expect(withToken.status, withToken.output).toBe(0)
    expect(withToken.calls()).toContain('docker login ghcr.io -u studio --password-stdin')
    expect(withToken.calls()).not.toContain('ghp_из_окружения')

    const noToken = install([...required, '--dir', dir, '--yes', '--ghcr-user', 'studio'], {
      fakes: { dns: dnsOk, caddyRunning: true },
      env: { AVERRA_OWNER_PASSWORD: 'пароль-владельца' },
    })
    expect(noToken.status).toBe(1)
    expect(noToken.stderr).toContain('нет терминала, чтобы спросить токен ghcr.io')
    expect(noToken.calls()).not.toContain('compose pull')
  })

  it('образы не скачались — подсказка называет оба случая: закрытый пакет и нет версии', () => {
    // Так отвечает GHCR: публичный пакет без такого тега и закрытый пакет без входа
    for (const pullError of [
      'Error response from daemon: manifest unknown',
      'Error response from daemon: denied',
    ]) {
      // Своя папка на каждый ответ: вторая установка не идёт поверх .env первой
      const dir = posix(join(tempDir(), 'inst'))
      const run = install([...required, '--dir', dir, '--yes'], {
        fakes: { dns: dnsOk, pullError },
        env: { AVERRA_OWNER_PASSWORD: 'пароль-владельца' },
      })
      expect(run.status).toBe(1)
      expect(run.stderr).toContain(pullError)
      expect(run.stderr).toContain('образы 0.6.0 не скачались.')
      expect(run.stderr).toContain('Ответ denied или unauthorized — пакеты в GHCR закрытые')
      expect(run.stderr).toContain('опечатка в имени образа')
      expect(run.stderr).toContain('Ответ manifest unknown — такой версии нет, проверьте --version')
      expect(run.calls()).not.toContain('up -d')
    }
  })

  it('повторный запуск владельца второй раз не создаёт, порты занятые своим Caddy — не помеха', () => {
    const dir = join(tempDir(), 'inst')
    const options = { fakes: { dns: dnsOk }, env: { AVERRA_OWNER_PASSWORD: 'пароль-владельца' } }
    expect(install([...required, '--dir', posix(dir), '--yes'], options).status).toBe(0)
    const before = readEnv(dir)
    const again = install(['--dir', posix(dir), '--yes'], {
      fakes: { dns: dnsOk, busyPorts: [80, 443], caddyRunning: true },
    })
    expect(again.status, again.output).toBe(0)
    expect(again.calls()).not.toContain('user-create')
    expect(again.calls()).not.toContain('site-create')
    expect(readEnv(dir)).toEqual(before)
  })

  it('без пароля владельца и без терминала — отказ, а не владелец без пароля', () => {
    const dir = join(tempDir(), 'inst')
    const run = install([...required, '--dir', posix(dir), '--yes'], { fakes: { dns: dnsOk } })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('задайте AVERRA_OWNER_PASSWORD')
    expect(readEnv(dir).OWNER_EMAIL).toBe('')
  })

  it('DNS домена не на этот сервер — отказ с адресами; --public-ip за NAT и --skip-dns-check', () => {
    const dir = posix(join(tempDir(), 'inst'))
    const elsewhere = { 'example.ru': '198.51.100.7', 'admin.example.ru': '198.51.100.7' }
    const wrong = install([...required, '--dir', dir, '--env-only'], { fakes: { dns: elsewhere } })
    // --env-only Docker и сеть не проверяет
    expect(wrong.status).toBe(0)
    const run = install([...required, '--dir', dir, '--yes'], { fakes: { dns: elsewhere } })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('домен example.ru указывает на 198.51.100.7')
    expect(run.stderr).toContain('203.0.113.5')
    expect(run.calls()).not.toContain('compose pull')

    const missing = install([...required, '--dir', dir, '--yes'], {
      fakes: { dns: { 'example.ru': '203.0.113.5' } },
    })
    expect(missing.stderr).toContain('домен admin.example.ru не находится в DNS')

    const nat = install([...required, '--dir', dir, '--yes', '--public-ip', '198.51.100.7'], {
      fakes: { dns: elsewhere },
      env: { AVERRA_OWNER_PASSWORD: 'пароль-владельца' },
    })
    expect(nat.status, nat.output).toBe(0)
    const skipped = install([...required, '--dir', dir, '--yes', '--skip-dns-check'], { fakes: {} })
    expect(skipped.status, skipped.output).toBe(0)
  })

  it('DNS: все A и AAAA домена должны вести на сервер — чужая AAAA при верной A тоже отказ', () => {
    const dir = posix(join(tempDir(), 'inst'))
    const owner = { AVERRA_OWNER_PASSWORD: 'пароль-владельца' }
    // Сервер без IPv6, у домена верная A и чужая AAAA (ставит панель регистратора):
    // Let's Encrypt пойдёт по IPv6 первым, и сертификат не выпустится
    const strayAaaa = {
      'example.ru': '203.0.113.5 2001:db8::99',
      'admin.example.ru': '203.0.113.5',
    }
    const run = install([...required, '--dir', dir, '--yes'], {
      fakes: { dns: strayAaaa },
      env: owner,
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('домен example.ru указывает на 2001:db8::99 203.0.113.5')
    expect(run.stderr).toContain('не этого сервера: 2001:db8::99')
    expect(run.stderr).toContain('AAAA-запись направьте на IPv6 этого сервера или удалите её')
    expect(run.stderr).not.toContain('admin.example.ru указывает')
    expect(run.calls()).not.toContain('compose pull')

    // Лишняя A-запись на чужой адрес — тоже отказ, со своей подсказкой
    const extraA = install([...required, '--dir', dir, '--dry-run'], {
      fakes: {
        dns: { 'example.ru': '203.0.113.5 198.51.100.7', 'admin.example.ru': '203.0.113.5' },
      },
    })
    expect(extraA.status).toBe(1)
    expect(extraA.stdout).toContain('не этого сервера: 198.51.100.7')
    expect(extraA.stdout).toContain('лишние A-записи удалите')

    // AAAA на IPv6 самого сервера — всё верно. За NAT оба адреса — флагом на каждый
    const ownAaaa = { 'example.ru': '203.0.113.5 2001:db8::5', 'admin.example.ru': '203.0.113.5' }
    const v6 = install([...required, '--dir', dir, '--yes'], {
      fakes: { dns: ownAaaa, serverIps: '203.0.113.5 10.0.0.2 2001:db8::5' },
      env: owner,
    })
    expect(v6.status, v6.output).toBe(0)
    const nat = install(
      [
        ...required,
        '--dir',
        dir,
        '--yes',
        '--public-ip',
        '203.0.113.5',
        '--public-ip',
        '2001:db8::5',
      ],
      { fakes: { dns: ownAaaa, serverIps: '10.0.0.2' }, env: owner },
    )
    expect(nat.status, nat.output).toBe(0)
  })

  it('занятые чужим сервером порты 80 и 443 — отказ до запуска', () => {
    const dir = posix(join(tempDir(), 'inst'))
    const run = install([...required, '--dir', dir, '--yes'], {
      fakes: { dns: dnsOk, busyPorts: [80] },
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('порты заняты: 80')
    expect(run.calls()).not.toContain('compose pull')
  })

  it('Docker без прав — понятная ошибка', () => {
    const dir = posix(join(tempDir(), 'inst'))
    const run = install([...required, '--dir', dir, '--yes'], {
      fakes: { dns: dnsOk, dockerDenied: true },
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('Docker не отвечает или нет прав')
  })
})

describe('дополнительные домены-редиректы (--redirect-domain)', () => {
  const dnsWww = { ...dnsOk, 'www.example.ru': '203.0.113.5', 'old.example.net': '203.0.113.5' }
  const redirects = ['--redirect-domain', 'www.example.ru', '--redirect-domain', 'old.example.net']

  it('повторяемый флаг: список в .env через пробел, план в сухом прогоне', () => {
    const dir = join(tempDir(), 'inst')
    const run = install([...required, ...redirects, '--dir', posix(dir), '--env-only'])
    expect(run.status, run.output).toBe(0)
    expect(readEnv(dir).REDIRECT_DOMAINS).toBe('www.example.ru old.example.net')

    const dry = install([...required, ...redirects, '--dir', posix(dir), '--dry-run'], {
      fakes: { dns: dnsWww },
    })
    expect(dry.status, dry.output).toBe(0)
    expect(dry.stdout).toContain(
      'Редиректы:         www.example.ru, old.example.net → https://example.ru',
    )
    // Без флагов список пуст: ключ в .env есть, значения нет
    const plain = join(tempDir(), 'plain')
    expect(install([...required, '--dir', posix(plain), '--env-only']).status).toBe(0)
    expect(readEnv(plain).REDIRECT_DOMAINS).toBe('')
    const planPlain = install([...required, '--dir', posix(plain), '--dry-run', '--skip-dns-check'])
    expect(planPlain.stdout).toContain('Редиректы:         нет')
  })

  it('имя со схемой, путём, портом, пробелом, заглавными, как сайт или админка — отказ', () => {
    const dir = posix(join(tempDir(), 'inst'))
    const cases: [string[], string][] = [
      [
        ['--redirect-domain', 'https://www.example.ru'],
        'дополнительный домен «https://www.example.ru» — не домен',
      ],
      [['--redirect-domain', 'www.example.ru/path'], 'не домен'],
      [['--redirect-domain', 'www.example.ru:8443'], 'не домен'],
      [['--redirect-domain', 'www.example.ru {'], 'не домен'],
      [['--redirect-domain', 'WWW.example.ru'], 'не домен'],
      [['--redirect-domain', '*.example.ru'], 'не домен'],
      [['--redirect-domain', 'localhost'], 'не домен'],
      [['--redirect-domain', 'example.ru'], 'совпадает с доменом сайта или админки'],
      [['--redirect-domain', 'admin.example.ru'], 'совпадает с доменом сайта или админки'],
      [['--redirect-domain', 'www.example.ru', '--no-redirect-domains'], 'непонятно, что оставить'],
      [['--redirect-domain'], 'у флага --redirect-domain нет значения'],
    ]
    for (const [override, message] of cases) {
      const run = install([...required, ...override, '--dir', dir, '--dry-run'])
      expect(run.status, override.join(' ')).toBe(1)
      expect(run.stderr, override.join(' ')).toContain(message)
    }
    expect(existsSync(dir)).toBe(false)
  })

  it('повтор имени сворачивается, больше десяти доменов — отказ', () => {
    const dir = join(tempDir(), 'inst')
    const twice = install([
      ...required,
      '--redirect-domain',
      'www.example.ru',
      '--redirect-domain',
      'www.example.ru',
      '--dir',
      posix(dir),
      '--env-only',
    ])
    expect(twice.status, twice.output).toBe(0)
    expect(readEnv(dir).REDIRECT_DOMAINS).toBe('www.example.ru')

    const many = Array.from({ length: 11 }, (_, i) => ['--redirect-domain', `old${i}.example.net`])
    const run = install([...required, ...many.flat(), '--dir', posix(dir), '--env-only'])
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('дополнительных доменов 11, а можно до 10')
  })

  it('DNS дополнительных доменов проверяется как основных; --skip-dns-check и --public-ip действуют', () => {
    const dir = posix(join(tempDir(), 'inst'))
    const badWww = { ...dnsOk, 'www.example.ru': '198.51.100.7' }
    const wrong = install([...required, ...redirects, '--dir', dir, '--dry-run'], {
      fakes: { dns: badWww },
    })
    expect(wrong.status).toBe(1)
    expect(wrong.stdout).toContain('не пройдёт: домен www.example.ru указывает на 198.51.100.7')
    expect(wrong.stdout).toContain('не пройдёт: домен old.example.net не находится в DNS')
    expect(wrong.stdout).toContain('Проблем: 2')

    // Настоящая установка останавливается до записи и запуска
    const real = install([...required, ...redirects, '--dir', dir, '--yes'], {
      fakes: { dns: badWww },
    })
    expect(real.status).toBe(1)
    expect(real.stderr).toContain('домен www.example.ru указывает на 198.51.100.7')
    expect(real.calls()).not.toContain('compose pull')

    const skipped = install(
      [...required, ...redirects, '--dir', dir, '--dry-run', '--skip-dns-check'],
      { fakes: { dns: dnsOk } },
    )
    expect(skipped.status, skipped.output).toBe(0)
    const natDns = Object.fromEntries(Object.keys(dnsWww).map((name) => [name, '198.51.100.7']))
    const nat = install(
      [...required, ...redirects, '--dir', dir, '--dry-run', '--public-ip', '198.51.100.7'],
      { fakes: { dns: natDns } },
    )
    expect(nat.status, nat.output).toBe(0)
  })

  it('повторный запуск: без флагов список остаётся, с флагами заменяется, --no-redirect-domains очищает', () => {
    const dir = join(tempDir(), 'inst')
    const args = ['--dir', posix(dir), '--env-only', '--yes']
    expect(install([...required, ...redirects, ...args]).status).toBe(0)
    expect(readEnv(dir).REDIRECT_DOMAINS).toBe('www.example.ru old.example.net')

    expect(install(args).status).toBe(0)
    expect(readEnv(dir).REDIRECT_DOMAINS).toBe('www.example.ru old.example.net')

    // Один домен убран, другой добавлен: прежний список заменён целиком
    const changed = install([
      ...args,
      '--redirect-domain',
      'www.example.ru',
      '--redirect-domain',
      'new.example.org',
    ])
    expect(changed.status, changed.output).toBe(0)
    expect(readEnv(dir).REDIRECT_DOMAINS).toBe('www.example.ru new.example.org')

    const cleared = install([...args, '--no-redirect-domains'])
    expect(cleared.status, cleared.output).toBe(0)
    expect(readEnv(dir).REDIRECT_DOMAINS).toBe('')
    expect(readEnv(dir)).toMatchObject({
      SITE_DOMAIN: 'example.ru',
      ADMIN_DOMAIN: 'admin.example.ru',
    })
    const text = readFileSync(join(dir, '.env'), 'utf8')
    expect(text.match(/^REDIRECT_DOMAINS=/gm)).toHaveLength(1)
  })

  it('значение, правленное в .env руками, проверяется так же: кривое — отказ', () => {
    const dir = join(tempDir(), 'inst')
    expect(install([...required, '--dir', posix(dir), '--env-only']).status).toBe(0)
    const text = readFileSync(join(dir, '.env'), 'utf8')
    writeFileSync(
      join(dir, '.env'),
      text.replace('REDIRECT_DOMAINS=', 'REDIRECT_DOMAINS=www.example.ru } evil.ru'),
    )
    const run = install(['--dir', posix(dir), '--env-only', '--yes'])
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('дополнительный домен «}» — не домен')
  })

  it('полная установка: DNS всех доменов проверен, список в .env', () => {
    const dir = posix(join(tempDir(), 'inst'))
    const run = install([...required, ...redirects, '--dir', dir, '--yes'], {
      fakes: { dns: dnsWww },
      env: { AVERRA_OWNER_PASSWORD: 'пароль-владельца' },
    })
    expect(run.status, run.output).toBe(0)
    expect(run.stdout).toContain('Редиректы: www.example.ru, old.example.net → https://example.ru')
    expect(readEnv(dir).REDIRECT_DOMAINS).toBe('www.example.ru old.example.net')
  })

  describe('Caddyfile и compose', () => {
    // Caddy в образе и тестах не запускается: Caddyfile разбирается как текст
    const caddyfile = readFileSync(fileURLToPath(new URL('../Caddyfile', import.meta.url)), 'utf8')
    const text = caddyfile
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
    const start = text.indexOf('{$REDIRECT_DOMAINS')
    const block = text.slice(start, text.indexOf('\n}', start))

    it('блок: адреса из REDIRECT_DOMAINS, постоянный редирект на сайт с путём и запросом', () => {
      expect(block).toContain('{$REDIRECT_DOMAINS:http://redirect-none.invalid} {')
      expect(block).toContain('redir https://{$SITE_DOMAIN}{uri} permanent')
      expect(block).toContain('import security')
      // Только редирект: сайт, админка и API с этих доменов не отдаются
      expect(block).not.toMatch(/file_server|reverse_proxy|handle/)
    })

    it('скобки Caddyfile сбалансированы, блоков сайта три: админка, сайт, редиректы', () => {
      let depth = 0
      // Подстановки {$ИМЯ}, {uri}, {file.…} — не блоки
      for (const ch of text.replace(/\{[$a-z_][^{}\s]*\}/gi, '')) {
        if (ch === '{') depth++
        if (ch === '}') depth--
        expect(depth).toBeGreaterThanOrEqual(0)
      }
      expect(depth).toBe(0)
      const sites = [...text.matchAll(/^\{\$(\w+)[^}\s]*\} \{$/gm)].map((match) => match[1])
      expect(sites).toEqual(['ADMIN_DOMAIN', 'SITE_DOMAIN', 'REDIRECT_DOMAINS'])
    })

    it('подстановка списка даёт адреса через пробел; пустой список — заглушка из compose', () => {
      // Caddy подставляет {$…} до разбора: адреса блока — то, что получилось после замены
      const header = block
        .split('\n')[0]
        ?.replace(
          '{$REDIRECT_DOMAINS:http://redirect-none.invalid}',
          'www.example.ru old.example.net',
        )
      expect(header).toBe('www.example.ru old.example.net {')
      for (const file of [composeFile, externalComposeFile]) {
        expect(readFileSync(file, 'utf8'), file).toContain(
          `REDIRECT_DOMAINS: \${REDIRECT_DOMAINS:-http://redirect-none.invalid}`,
        )
      }
    })
  })
})

describe('образ и compose не включают учебный режим', () => {
  const dockerfile = readFileSync(fileURLToPath(new URL('../Dockerfile', import.meta.url)), 'utf8')
  const compose = readFileSync(composeFile, 'utf8')

  it('API на сервере — прод: NODE_ENV=production, без флага --dev и не от root', () => {
    expect(compose).toMatch(/NODE_ENV: production/)
    expect(dockerfile).toMatch(/ENV NODE_ENV=production/)
    expect(`${dockerfile}\n${compose}`).not.toMatch(/--dev\b/)
    expect(dockerfile).toMatch(/^USER node$/m)
    expect(dockerfile).toContain('CMD ["node", "--enable-source-maps", "dist/server/index.js"]')
  })

  it('сайт установки: API получает адрес и название сайта, Caddy — без SITE_ID', () => {
    const api = /\n {2}api:\n([\s\S]*?)\n {2}caddy:/.exec(compose)?.[1] ?? ''
    const caddy = /\n {2}caddy:\n([\s\S]*?)\nvolumes:/.exec(compose)?.[1] ?? ''
    expect(api).toMatch(/SITE_URL: https:\/\/\$\{SITE_DOMAIN:\?/)
    // У прежних установок строки SITE_NAME в .env нет: пусто — API возьмёт домен сайта
    expect(api).toMatch(/SITE_NAME: \$\{SITE_NAME:-\}/)
    expect(caddy).not.toContain('SITE_ID')
  })

  it('секреты compose берёт из .env и без них не стартует', () => {
    for (const key of ['POSTGRES_PASSWORD', 'AUTH_SECRET', 'MAIL_ENCRYPTION_KEY']) {
      expect(compose).toMatch(new RegExp(`\\$\\{${key}:\\?`))
    }
    expect(compose).not.toMatch(/DEV_|MAIL_TRANSPORT: file/)
  })
})

/** Строки без комментариев: проверяем то, что действует, а не то, что о нём написано */
const code = (text: string) =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')

describe('контейнеры не от root и без лишних прав', () => {
  const dockerfile = code(
    readFileSync(fileURLToPath(new URL('../Dockerfile', import.meta.url)), 'utf8'),
  )
  const compose = code(readFileSync(composeFile, 'utf8'))

  /** Стадия Dockerfile по имени: от её FROM до следующего */
  const stage = (name: string) => {
    const found = dockerfile.split(/^(?=FROM )/m).find((part) => part.includes(` AS ${name}\n`))
    if (!found) throw new Error(`Нет стадии ${name}`)
    return found
  }
  /** Последний USER стадии — от кого запускается образ */
  const lastUser = (text: string) => [...text.matchAll(/^USER (\S+)$/gm)].at(-1)?.[1]

  /** Сервис compose.yaml: от «  имя:» до следующего сервиса или раздела */
  const service = (name: string) => {
    const match = new RegExp(`^  ${name}:\n((?:    .*\n|\n)*)`, 'm').exec(`${compose}\n`)
    if (!match?.[1]) throw new Error(`Нет сервиса ${name}`)
    return match[1]
  }

  it('образы api и web (Caddy, открыт в интернет) запускаются не от root', () => {
    expect(lastUser(stage('api'))).toBe('node')
    expect(lastUser(stage('web'))).toBe('caddy')
    // Тома Caddy (сертификаты, настройки) принадлежат его пользователю
    expect(stage('web')).toMatch(/chown -R caddy:caddy \/data \/config/)
  })

  it('api: код рендерера не за node — кеши сборщика в томе сайтов, .astro — ссылка туда', () => {
    const api = stage('api')
    // node владеет только томами данных; ни /app, ни папка рендерера ему не отдаются
    const chowns = [...api.matchAll(/chown\s+(?:-R\s+)?node:node\s+([^\n&\\]+)/g)].map((m) =>
      m[1]?.trim(),
    )
    expect(chowns).toEqual(['/data'])
    expect(api).not.toMatch(/chown[^\n]*\/app/)
    expect(api).toContain('ln -s /data/sites/.cache/dot-astro /app/apps/renderer/.astro')
    expect(api).toMatch(/PUBLISH_DIR=\/data\/sites/)
    // Ссылка ведёт в PUBLISH_DIR/.cache/<DOT_ASTRO_CACHE> — ту папку, что API создаёт перед сборкой
    const renderer = readFileSync(
      fileURLToPath(new URL('../../apps/api/src/publish/renderer.ts', import.meta.url)),
      'utf8',
    )
    expect(renderer).toContain("export const DOT_ASTRO_CACHE = 'dot-astro'")
    const index = readFileSync(
      fileURLToPath(new URL('../../apps/api/src/index.ts', import.meta.url)),
      'utf8',
    )
    expect(index).toContain("cacheDir: join(config.PUBLISH_DIR, '.cache')")
  })

  it('на сервер копируются только файлы, которые берёт установщик, а не папка deploy', () => {
    const installer = readFileSync(script, 'utf8')
    const needed = [
      'install.sh',
      ...new Set([...installer.matchAll(/"\$SCRIPT_DIR\/([\w.]+)"/g)].map((m) => m[1])),
    ].sort()
    expect(needed).toEqual(['averra.sh', 'compose.external.yaml', 'compose.yaml', 'install.sh'])
    // Команду копирования студия берёт со страницы установки в документации
    const docsPage = fileURLToPath(
      new URL('../../apps/docs/src/content/docs/install/server.md', import.meta.url),
    )
    const instructions = readFileSync(docsPage, 'utf8')
    const scp = instructions.split('\n').filter((line) => /^scp /.test(line))
    expect(scp).toHaveLength(1)
    const copied = [...(scp[0] ?? '').matchAll(/deploy\/([\w.]+)/g)].map((m) => m[1]).sort()
    expect(copied).toEqual(needed)
    expect(instructions).not.toMatch(/scp -r deploy/)
  })

  it('TRUST_PROXY включает compose рядом с Caddy, а не образ: docker run без прокси ему не верит', () => {
    expect(dockerfile).not.toContain('TRUST_PROXY')
    expect(service('api')).toContain("TRUST_PROXY: 'true'")
  })

  it('api: init пожинает потомков сборщика, ни одной capability, без повышения прав', () => {
    const api = service('api')
    expect(api).toMatch(/^ {4}init: true$/m)
    expect(api).toMatch(/^ {4}cap_drop: \[ALL\]$/m)
    expect(api).toContain('no-new-privileges:true')
    expect(api).not.toContain('cap_add')
  })

  it('caddy: из прав — только порты 80 и 443', () => {
    const caddy = service('caddy')
    expect(caddy).toMatch(/^ {4}cap_drop: \[ALL\]$/m)
    expect(caddy).toMatch(/^ {4}cap_add: \[NET_BIND_SERVICE\]$/m)
    expect(caddy).toMatch(/net\.ipv4\.ip_unprivileged_port_start: 0/)
  })

  it('версия и конфигурация установки — в образе API, состояние — только на чтение, бэкапов в контейнере нет', () => {
    const api = stage('api')
    expect(api).toMatch(/^ARG AVERRA_VERSION=dev$/m)
    expect(api).toMatch(/AVERRA_VERSION=\$\{AVERRA_VERSION\}/)
    // averra.sh update берёт compose.yaml и себя из образа новой версии
    expect(stage('runtime-tree')).toMatch(
      /^COPY deploy\/compose\.yaml deploy\/compose\.external\.yaml deploy\/averra\.sh deploy\/$/m,
    )
    expect(service('api')).toContain('- ./state:/data/state:ro')
    expect(service('api')).toContain('STATE_DIR: /data/state')
    expect(compose).not.toContain('backups')
    // На хосте API пишет только в папку заявок: ни сокета Docker, ни других папок хоста
    expect(service('api')).toContain('- ./requests:/data/requests\n')
    expect(service('api')).toContain('REQUESTS_DIR: /data/requests')
    const hostMounts = [...service('api').matchAll(/^\s+- (\.\/[^:\s]+):(\S+)$/gm)].map(
      (m) => `${m[1]}:${m[2]}`,
    )
    expect(hostMounts).toEqual(['./state:/data/state:ro', './requests:/data/requests'])
    expect(compose).not.toContain('docker.sock')
  })

  it('список серверов студии не попадает в контекст сборки образа', () => {
    const ignore = readFileSync(
      fileURLToPath(new URL('../../.dockerignore', import.meta.url)),
      'utf8',
    )
    expect(ignore).toMatch(/^\*\*\/servers\.txt$/m)
  })
})

describe('Caddyfile: кеш', () => {
  const caddyfile = code(
    readFileSync(fileURLToPath(new URL('../Caddyfile', import.meta.url)), 'utf8'),
  )
  /** Блок сайта Caddyfile по адресу: от «{$ИМЯ} {» до закрывающей скобки в начале строки */
  const siteBlock = (address: string) => {
    const start = caddyfile.indexOf(`${address} {`)
    if (start < 0) throw new Error(`Нет блока ${address}`)
    return caddyfile.slice(start, caddyfile.indexOf('\n}', start))
  }
  /** Ветки handle блока: матчер → тело */
  const handles = (block: string) =>
    [...block.matchAll(/^\thandle ?(\S*) \{\n([\s\S]*?)^\t\}/gm)].map((match) => ({
      matcher: match[1] ?? '',
      body: match[2] ?? '',
    }))

  it('админка: index.html и экраны SPA — no-cache на всю ветку, а не только на /index.html', () => {
    const admin = handles(siteBlock('{$ADMIN_DOMAIN}'))
    const spa = admin.find((branch) => branch.matcher === '')
    // header выполняется раньше try_files и видит исходный путь: матчер по /index.html не сработает
    expect(spa?.body).toMatch(/^\t\theader Cache-Control "no-cache"$/m)
    expect(spa?.body).toContain('try_files {path} /index.html')
    expect(siteBlock('{$ADMIN_DOMAIN}')).not.toMatch(/header \/index\.html/)
  })

  it('админка: ассеты — immutable и без try_files (нет файла — 404, а не index.html)', () => {
    const assets = handles(siteBlock('{$ADMIN_DOMAIN}')).find(
      (branch) => branch.matcher === '/assets/*',
    )
    expect(assets?.body).toContain('immutable')
    expect(assets?.body).not.toContain('try_files')
    expect(assets?.body).toContain('file_server')
  })

  it('сайт: отдаётся сайт установки по ссылке main, которую ставит API, — id сайта не нужен', () => {
    const site = siteBlock('{$SITE_DOMAIN}')
    expect(site).toMatch(/^\t\troot \* \/srv\/sites\/main\/current$/m)
    expect(caddyfile).not.toContain('SITE_ID')
  })

  it('сайт: immutable только у файлов Astro, шрифтов и картинок /media/<uuid>/, страница media — no-cache', () => {
    const site = siteBlock('{$SITE_DOMAIN}')
    const immutable = /@immutable path_regexp (\S+)/.exec(site)?.[1]
    const pages = /@pages not path_regexp (\S+)/.exec(site)?.[1]
    expect(immutable).toBeDefined()
    // Страницы — ровно то, что не immutable
    expect(pages).toBe(immutable)
    // Синтаксис RE2 в Caddy здесь тот же, что у RegExp
    const re = new RegExp(immutable ?? '')
    expect(re.test('/_astro/index.Bx1.css')).toBe(true)
    expect(re.test('/_fonts/golos-text-cyrillic-400-normal-15a5cbadfc.woff2')).toBe(true)
    expect(re.test('/media/c6026fd5-5af8-4af9-a36e-1e08b05210a8/640.webp')).toBe(true)
    expect(re.test('/media/')).toBe(false)
    expect(re.test('/media/index.html')).toBe(false)
    expect(re.test('/')).toBe(false)
    expect(re.test('/o-nas/')).toBe(false)
    // Иконки и манифест могут смениться под тем же адресом: проверяются при каждом заходе
    expect(re.test('/favicon.ico')).toBe(false)
    expect(re.test('/manifest.webmanifest')).toBe(false)
  })

  it('сайт: SVG из медиатеки — с той же CSP, что отдаёт API, и только по адресу файла SVG', () => {
    const site = siteBlock('{$SITE_DOMAIN}')
    const svg = /@svg path_regexp (\S+)/.exec(site)?.[1]
    const re = new RegExp(svg ?? '^$')
    expect(re.test('/media/c6026fd5-5af8-4af9-a36e-1e08b05210a8/image.svg')).toBe(true)
    expect(re.test('/media/c6026fd5-5af8-4af9-a36e-1e08b05210a8/640.webp')).toBe(false)
    expect(re.test('/media/c6026fd5-5af8-4af9-a36e-1e08b05210a8/image.svg/x')).toBe(false)
    expect(site).toContain(
      `header @svg Content-Security-Policy "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"`,
    )
  })

  it('сайт: адрес без файла уходит в API — редирект из «SEO» или страница 404 релиза', () => {
    const site = siteBlock('{$SITE_DOMAIN}')
    const errors = /^\thandle_errors 404 \{\n([\s\S]*?)^\t\}/m.exec(site)?.[1] ?? ''
    expect(errors).toContain('reverse_proxy api:4000')
    // Путь — исходный и экранированный: API ищет по нему редирект (GET /api/site/fallback/*), а
    // %3F в пути не становится строкой запроса. Раскодированный orig_uri.path здесь нельзя
    expect(errors).toMatch(/^\t\t\trewrite \/api\/site\/fallback\{http\.request\.uri\.path\}$/m)
    expect(errors).not.toContain('orig_uri')
    expect(errors).toContain('import security')
    // Своего текста 404 у Caddy больше нет: страницу 404 отдаёт API из релиза
    expect(errors).not.toContain('respond')
    // Наружу из API на домене сайта открыт только приём форм: fallback — через ошибку 404
    expect(handles(site).map((branch) => branch.matcher)).toEqual(['/api/forms/*', ''])
  })

  it('сайт: свои скрипты /_scripts/<имя>.<хеш>.js — immutable', () => {
    const site = siteBlock('{$SITE_DOMAIN}')
    const re = new RegExp(/@immutable path_regexp (\S+)/.exec(site)?.[1] ?? '^$')
    expect(re.test('/_scripts/block-tabs.0123456789.js')).toBe(true)
    expect(re.test('/_scripts/site.0123456789.js')).toBe(true)
  })

  it('сайт: CSP — из файла текущей версии сайта, на каждом ответе, и на странице 404 тоже', () => {
    const snippet = /^\(site_csp\) \{\n([\s\S]*?)^\}/m.exec(caddyfile)?.[1] ?? ''
    // Файл пишет сборка (SITE_CSP_FILE в @averra/schema); плейсхолдер file читается на запрос
    expect(snippet).toMatch(
      /^\theader Content-Security-Policy "\{file\.\/srv\/sites\/main\/current\/_averra\/csp\.txt\}"$/m,
    )
    const site = siteBlock('{$SITE_DOMAIN}')
    expect(site).toMatch(/^\timport site_csp$/m)
    const errors = /^\thandle_errors 404 \{\n([\s\S]*?)^\t\}/m.exec(site)?.[1] ?? ''
    expect(errors).toMatch(/^\t\timport site_csp$/m)
    // Админке — нет: у неё своя модель (предпросмотр, Vite), CSP сайта ей не подходит
    expect(siteBlock('{$ADMIN_DOMAIN}')).not.toContain('site_csp')
  })
})

describe('внешняя база (--external-db)', () => {
  /** Пароль со знаками, которые ломают адреса и .env: @ : / # ? % $ */
  const password = 'p@ss:w/r#d?%$HOME1'
  // В адресе — percent-encoded, кроме $: он в адресе законен и проверяет кавычки в .env
  const encoded = 'p%40ss%3Aw%2Fr%23d%3F%25$HOME1'
  const url = `postgres://averra_app:${encoded}@db.example.test:6432/averra_site`
  const external = [...required, '--external-db', '--yes']

  /** Значение из .env так, как его прочтёт Compose: '…' — буквально, иначе $VAR подставляется */
  function composeValue(dir: string, key: string) {
    const line = readFileSync(join(dir, '.env'), 'utf8')
      .split('\n')
      .find((item) => item.startsWith(`${key}=`))
    const raw = (line ?? '').slice(key.length + 1)
    if (/^'.*'$/.test(raw)) return raw.slice(1, -1)
    return raw.replace(/\$\{?([A-Z_]+)\}?/g, '')
  }

  it('установка: адрес из окружения, TLS verify-full, проверка прав клиентом той же версии, без своей базы', () => {
    const dir = join(tempDir(), 'inst')
    const run = install([...external, '--dir', posix(dir)], {
      fakes: { dns: dnsOk },
      env: { AVERRA_DATABASE_URL: url, AVERRA_OWNER_PASSWORD: 'пароль-владельца' },
    })
    expect(run.status, run.output).toBe(0)
    const env = readEnv(dir)
    expect(env).toMatchObject({
      AVERRA_DB_MODE: 'external',
      AVERRA_PG_IMAGE: 'postgres:18.6-alpine3.24',
    })
    // Своей базы нет — нет и её пароля
    expect(env).not.toHaveProperty('POSTGRES_PASSWORD')
    // В .env — в одинарных кавычках, с verify-full: Compose отдаст API адрес как есть, с $
    const text = readFileSync(join(dir, '.env'), 'utf8')
    expect(text).toContain(`DATABASE_URL='${url}?sslmode=verify-full'\n`)
    const forApi = new URL(composeValue(dir, 'DATABASE_URL'))
    expect(decodeURIComponent(forApi.password)).toBe(password)
    expect(forApi.searchParams.get('sslmode')).toBe('verify-full')
    // Без кавычек Compose съел бы $HOME — тест бы это поймал
    expect(composeValue(dir, 'DATABASE_URL')).toContain('$HOME1')
    // Своя база не нужна: compose.yaml — внешний, поднимается только API
    expect(readFileSync(join(dir, 'compose.yaml'), 'utf8')).toBe(
      readFileSync(externalComposeFile, 'utf8'),
    )
    const steps = run
      .calls()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replace(/ \| .*$/, '').replace(/--project-directory \S+ /, ''))
    expect(steps).toContain('docker compose up -d api')
    expect(steps.join('\n')).not.toContain('up -d postgres')
    const probe = steps.find((line) => line.includes(' psql '))
    expect(probe).toMatch(
      /^docker run --rm --cap-drop ALL --security-opt no-new-privileges:true -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGSSLROOTCERT -e PGCONNECT_TIMEOUT postgres:17\.11-alpine3\.24 psql /,
    )
    // Проверка — до записи .env и до pull
    expect(steps.indexOf(probe ?? '')).toBeLessThan(steps.indexOf('docker compose pull'))
    // Клиент бэкапов той же версии, что сервер, скачан при установке — сразу после проверки, а не
    // впервые ночью
    const clientPull = steps.indexOf('docker pull postgres:18.6-alpine3.24')
    expect(clientPull).toBeGreaterThan(steps.indexOf(probe ?? ''))
    expect(clientPull).toBeLessThan(steps.indexOf('docker compose pull'))
    // Пароль дошёл до клиента раскодированным — переменной, не аргументом и не в выводе
    expect(run.pgEnv()).toBe(
      `host=db.example.test port=6432 user=averra_app password=${password} db=averra_site sslmode=verify-full rootcert=system\n`,
    )
    for (const secret of [password, encoded, 'p%40ss']) {
      expect(run.calls()).not.toContain(secret)
      expect(run.output).not.toContain(secret)
    }
    expect(run.stdout).toContain('внешняя база: PostgreSQL 18')
    expect(existsSync(join(dir, 'db-tls'))).toBe(true)
    // Адрес из окружения после разбора убран: docker и остальные команды его не наследуют
    expect(run.dbUrlEnv()).toBe('')
  })

  it('повторный запуск без флага остаётся на внешней базе, адрес — из .env', () => {
    const dir = join(tempDir(), 'inst')
    const first = install([...external, '--dir', posix(dir), '--env-only'], {
      env: { AVERRA_DATABASE_URL: url },
    })
    expect(first.status, first.output).toBe(0)
    expect(first.stdout).toContain('Внешняя база не проверялась (--env-only)')
    const before = readFileSync(join(dir, '.env'), 'utf8')
    const again = install(['--dir', posix(dir), '--yes', '--dry-run'], { fakes: { dns: dnsOk } })
    expect(again.status, again.output).toBe(0)
    expect(again.stdout).toContain(
      'База:              внешняя — averra_app@db.example.test:6432/averra_site',
    )
    expect(again.pgEnv()).toContain(`password=${password} `)
    const envOnly = install(['--dir', posix(dir), '--yes', '--env-only'])
    expect(envOnly.status, envOnly.output).toBe(0)
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(before)
  })

  it('своя база с владельцем на внешнюю не переводится; --db-ca-file без внешней — отказ', () => {
    const dir = join(tempDir(), 'inst')
    expect(install([...required, '--dir', posix(dir), '--env-only']).status).toBe(0)
    writeFileSync(
      join(dir, '.env'),
      readFileSync(join(dir, '.env'), 'utf8').replace(/^OWNER_EMAIL=$/m, 'OWNER_EMAIL=a@b.ru'),
    )
    const before = readFileSync(join(dir, '.env'), 'utf8')
    const run = install([...external, '--dir', posix(dir), '--env-only'], {
      env: { AVERRA_DATABASE_URL: url },
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('установка уже работает со своей базой, в ней данные')
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(before)
    const ca = install([...required, '--dir', posix(dir), '--env-only', '--db-ca-file', 'x.pem'])
    expect(ca.status).toBe(1)
    expect(ca.stderr).toContain('--db-ca-file — только для внешней базы')
  })

  it('адрес без TLS, с непонятным sslmode или кривой — отказ с объяснением, без записи и Docker', () => {
    const cases: [string, string][] = [
      [`${url}?sslmode=disable`, 'sslmode=disable — соединение без обязательного TLS'],
      [`${url}?sslmode=prefer`, 'без обязательного TLS'],
      [`${url}?sslmode=require`, 'нужен verify-full'],
      [`${url}?sslrootcert=/etc/ca.pem`, '--db-ca-file'],
      [`${url}?target_session_attrs=any`, 'не поддерживается'],
      ['postgres://averra_app:p@ss@db.example.test/averra_site', '@ → %40'],
      ['postgres://averra_app:pa ss@db.example.test/averra_site', 'пробел'],
      ['postgres://averra_app:p%zz@db.example.test/averra_site', '% не перед двумя'],
      ['postgres://averra_app:p%00x@db.example.test/averra_site', '%00 (нулевой байт)'],
      // Байты не UTF-8: API (decodeURIComponent) такой адрес не разберёт
      ['postgres://averra_app:p%FF%FEx@db.example.test/averra_site', 'не текст UTF-8'],
      ['postgres://us%C3er:x@db.example.test/averra_site', 'не текст UTF-8'],
      ['postgres://averra_app@db.example.test/averra_site', 'пользователя и пароль'],
      ['postgres://averra_app:x@db.example.test:5432', 'нет имени базы'],
      ['postgres://averra_app:x@db.example.test:99999/db', 'не порт'],
      ['postgres://averra_app:x@a.test,b.test/db', 'один хост'],
      ['mysql://averra_app:x@db.example.test/db', 'postgres://'],
    ]
    for (const [address, error] of cases) {
      const dir = join(tempDir(), 'inst')
      const run = install([...external, '--dir', posix(dir)], {
        fakes: { dns: dnsOk },
        env: { AVERRA_DATABASE_URL: address },
      })
      expect(run.status, address).toBe(1)
      expect(run.stderr, address).toContain(error)
      expect(run.stderr, address).not.toContain(address)
      expect(existsSync(dir), address).toBe(false)
      expect(run.calls(), address).toBe('')
    }
  })

  it('пароль кириллицей (UTF-8 percent-encoded) принимается и доходит до клиента', () => {
    const dir = join(tempDir(), 'inst')
    const run = install([...external, '--dir', posix(dir), '--dry-run'], {
      fakes: { dns: dnsOk },
      env: { AVERRA_DATABASE_URL: url.replace(encoded, '%D0%BF%D0%B0%D1%80%D0%BE%D0%BB%D1%8C1') },
    })
    expect(run.status, run.output).toBe(0)
    expect(run.pgEnv()).toContain(' password=пароль1 ')
  })

  it('образ клиента бэкапов не скачался — отказ при установке, .env не записан', () => {
    const dir = join(tempDir(), 'inst')
    const run = install([...external, '--dir', posix(dir)], {
      fakes: { dns: dnsOk, clientPullFails: true },
      env: { AVERRA_DATABASE_URL: url },
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('образ postgres:18.6-alpine3.24 не скачался')
    expect(run.stderr).toContain('Docker Hub')
    expect(existsSync(join(dir, '.env'))).toBe(false)
    expect(run.calls()).not.toContain('compose pull')
  })

  it('повтор с адресом другой базы (миграций нет, владелец есть) — отказ, ничего не меняется', () => {
    const dir = join(tempDir(), 'inst')
    expect(
      install([...external, '--dir', posix(dir), '--env-only'], {
        env: { AVERRA_DATABASE_URL: url },
      }).status,
    ).toBe(0)
    writeFileSync(
      join(dir, '.env'),
      readFileSync(join(dir, '.env'), 'utf8').replace(/^OWNER_EMAIL=$/m, 'OWNER_EMAIL=a@b.ru'),
    )
    const before = readFileSync(join(dir, '.env'), 'utf8')
    const other = url.replace('/averra_site', '/averra_other')
    const run = install(['--dir', posix(dir), '--yes'], {
      fakes: { dns: dnsOk, dbFacts: '180006|t|t|0|f' },
      env: { AVERRA_DATABASE_URL: other },
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain(
      'во внешней базе averra_other нет миграций Averra, а владелец у установки уже создан: это не база этой установки',
    )
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(before)
    expect(run.calls()).not.toMatch(/pull|up -d/)
    // Та же база с миграциями — повтор проходит
    const same = install(['--dir', posix(dir), '--yes'], {
      fakes: { dns: dnsOk, dbFacts: '180006|t|t|30|t' },
    })
    expect(same.status, same.output).toBe(0)
  })

  it('своя база без владельца (установка оборвалась) на внешнюю — контейнер postgres убирается', () => {
    const dir = join(tempDir(), 'inst')
    expect(install([...required, '--dir', posix(dir), '--env-only']).status).toBe(0)
    const run = install([...external, '--dir', posix(dir)], {
      fakes: { dns: dnsOk },
      env: { AVERRA_DATABASE_URL: url, AVERRA_OWNER_PASSWORD: 'пароль-владельца' },
    })
    expect(run.status, run.output).toBe(0)
    const steps = run
      .calls()
      .split('\n')
      .map((line) => line.replace(/ \| .*$/, '').replace(/--project-directory \S+ /, ''))
    // Пока на месте прежний compose.yaml: иначе Compose о postgres уже не знал бы
    expect(steps).toContain('docker compose rm -sf postgres')
    expect(steps.indexOf('docker compose rm -sf postgres')).toBeLessThan(
      steps.indexOf('docker compose pull'),
    )
    expect(readEnv(dir)).toMatchObject({ AVERRA_DB_MODE: 'external' })
    // Повтор на внешней базе — уже ничего не убирает
    const again = install(['--dir', posix(dir), '--yes'], {
      fakes: { dns: dnsOk, dbFacts: '180006|t|t|30|t' },
    })
    expect(again.status, again.output).toBe(0)
    expect(again.calls()).not.toContain('rm -sf postgres')
  })

  it('без адреса и без терминала — отказ: адрес только переменной окружения', () => {
    const dir = join(tempDir(), 'inst')
    const run = install([...external, '--dir', posix(dir)], { fakes: { dns: dnsOk } })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('AVERRA_DATABASE_URL')
    expect(existsSync(dir)).toBe(false)
  })

  it('нет прав CREATE, чужие таблицы, старая версия, не входит — понятная ошибка и что выдать', () => {
    const cases: [Fakes, string][] = [
      [
        { dbFacts: '180006|f|t|0|f' },
        'нет права CREATE на базе averra_site: оно нужно миграциям (схема drizzle). Владелец базы выдаёт его так: GRANT CREATE ON DATABASE "averra_site" TO "averra_app";',
      ],
      [{ dbFacts: '180006|t|f|0|f' }, 'ALTER SCHEMA public OWNER TO "averra_app";'],
      [{ dbFacts: '150010|t|t|0|f' }, 'PostgreSQL 15: поддерживаются 16, 17 и 18'],
      [{ dbFacts: '180006|t|t|4|f' }, 'уже есть таблицы (4), а миграций Averra нет'],
      [
        {
          dbError:
            'psql: error: connection failed: FATAL:  no pg_hba.conf entry for host "203.0.113.5"',
        },
        'разрешите его IP (203.0.113.5 10.0.0.2 ) в pg_hba.conf',
      ],
      [{ dbError: 'psql: error: SSL error: certificate verify failed' }, '--db-ca-file'],
    ]
    for (const [fakes, error] of cases) {
      const dir = join(tempDir(), 'inst')
      const run = install([...external, '--dir', posix(dir)], {
        fakes: { dns: dnsOk, ...fakes },
        env: { AVERRA_DATABASE_URL: url, AVERRA_OWNER_PASSWORD: 'пароль-владельца' },
      })
      expect(run.status, error).toBe(1)
      expect(run.stderr, error).toContain(error)
      expect(run.output).not.toContain(password)
      // До записи .env и запуска чего-либо
      expect(existsSync(join(dir, '.env')), error).toBe(false)
      expect(run.calls(), error).not.toMatch(/pull|up -d/)
    }
  })

  it('сухой прогон: план с базой и проверки, ничего не пишет; проблема базы — в списке', () => {
    const dir = join(tempDir(), 'inst')
    const run = install([...external, '--dir', posix(dir), '--dry-run'], {
      fakes: { dns: dnsOk, dbFacts: '180006|f|t|0|f' },
      env: { AVERRA_DATABASE_URL: url },
    })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain(
      'База:              внешняя — averra_app@db.example.test:6432/averra_site, TLS verify-full',
    )
    expect(run.stdout).toContain('не пройдёт: у пользователя averra_app нет права CREATE')
    expect(run.stdout).toContain(
      'Новые секреты:     AUTH_SECRET MAIL_ENCRYPTION_KEY BACKUP_PASSPHRASE',
    )
    expect(existsSync(dir)).toBe(false)
  })

  it('--db-ca-file: CA провайдера — в db-tls, в адресе sslrootcert, проверка по нему', () => {
    const root = tempDir()
    const dir = join(root, 'inst')
    const ca = join(root, 'provider-ca.pem')
    writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n')
    const run = install([...external, '--dir', posix(dir), '--db-ca-file', posix(ca)], {
      fakes: { dns: dnsOk },
      env: { AVERRA_DATABASE_URL: url, AVERRA_OWNER_PASSWORD: 'пароль-владельца' },
    })
    expect(run.status, run.output).toBe(0)
    expect(readFileSync(join(dir, 'db-tls', 'ca.pem'), 'utf8')).toBe(readFileSync(ca, 'utf8'))
    expect(readEnv(dir).DATABASE_URL).toBe(
      `'${url}?sslmode=verify-full&sslrootcert=/run/averra-db/ca.pem'`,
    )
    expect(run.calls()).toMatch(/ -v \/\S*\/provider-ca\.pem:\/run\/averra-db\/ca\.pem:ro /)
    expect(run.pgEnv()).toContain('rootcert=/run/averra-db/ca.pem')
    // Повтор без флага: CA уже в папке установки, адрес из .env его помнит
    const again = install(['--dir', posix(dir), '--yes', '--env-only'])
    expect(again.status, again.output).toBe(0)
    expect(readEnv(dir).DATABASE_URL).toContain('sslrootcert=/run/averra-db/ca.pem')
    const notPem = join(root, 'x.pem')
    writeFileSync(notPem, 'мусор')
    const bad = install(
      [...external, '--dir', posix(join(root, 'b')), '--db-ca-file', posix(notPem)],
      {
        env: { AVERRA_DATABASE_URL: url },
      },
    )
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('не сертификат PEM')
  })

  it('--db-ca-file с относительным путём — в docker уходит абсолютный (иначе это имя тома)', () => {
    const root = tempDir()
    const dir = join(root, 'inst')
    writeFileSync(
      join(root, 'provider-ca.pem'),
      '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
    )
    for (const path of ['provider-ca.pem', './provider-ca.pem']) {
      const run = install([...external, '--dir', posix(dir), '--dry-run', '--db-ca-file', path], {
        fakes: { dns: dnsOk },
        env: { AVERRA_DATABASE_URL: url },
        cwd: root,
      })
      expect(run.status, run.output).toBe(0)
      expect(run.calls(), path).toMatch(/ -v \/\S*\/provider-ca\.pem:\/run\/averra-db\/ca\.pem:ro /)
      expect(run.calls(), path).not.toMatch(/\/\.\/provider-ca/)
    }
  })

  it('compose.external.yaml: тот же compose.yaml, но без своей базы, DATABASE_URL из .env', () => {
    const own = readFileSync(composeFile, 'utf8')
    const ext = readFileSync(externalComposeFile, 'utf8')
    expect(ext).not.toMatch(/^ {2}postgres:/m)
    expect(ext).not.toContain('depends_on:\n      postgres')
    expect(ext).toMatch(/DATABASE_URL: \$\{DATABASE_URL:\?/)
    expect(ext).toContain("DATABASE_EXTERNAL: 'true'")
    expect(ext).toContain('- ./db-tls:/run/averra-db:ro')
    // Остальное совпадает: caddy, тома и сеть, сервис api без строк базы
    const section = (text: string, from: string, to: string) =>
      text.slice(text.indexOf(from), to ? text.indexOf(to) : undefined)
    expect(section(ext, '  caddy:', '')).toBe(
      section(own, '  caddy:', '').replace('volumes:\n  postgres:\n', 'volumes:\n'),
    )
    const api = (text: string) =>
      code(section(text, '  api:', '  caddy:'))
        .split('\n')
        .filter(
          (line) => !/DATABASE_|db-tls|depends_on|postgres|condition: service_healthy/.test(line),
        )
        .join('\n')
    expect(api(ext)).toBe(api(own))
    // Образ клиента у проверки установщика — тот же, что у своей базы
    const installer = readFileSync(script, 'utf8')
    const image = /image: (postgres:\S+)/.exec(own)?.[1]
    expect(installer).toContain(`PG_PROBE_IMAGE='${image}'`)
    expect(installer).toContain(`17) printf '${image}'`)
  })

  it('разбор адреса и таблица образов — одним текстом в install.sh и averra.sh', () => {
    const shared = (file: string) => {
      const text = readFileSync(file, 'utf8')
      const start = text.indexOf('# ── Общее у install.sh и averra.sh')
      const end = text.indexOf('# ── Конец общего у install.sh и averra.sh')
      expect(start).toBeGreaterThan(0)
      return text.slice(start, end)
    }
    expect(shared(script)).toBe(shared(fileURLToPath(new URL('../averra.sh', import.meta.url))))
  })
})
