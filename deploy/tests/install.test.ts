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
}

const SITE_ID = 'c6026fd5-5af8-4af9-a36e-1e08b05210a8'

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
  write('systemctl', `printf '%s\\n' "$*" >> "${posix(join(root, 'systemctl.log'))}"`)
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
case "$*" in
  "info") ${fakes.dockerDenied ? 'exit 1' : 'exit 0'} ;;
  "compose version") exit 0 ;;
  *" ps --status running -q caddy") ${fakes.caddyRunning ? 'echo abc123' : 'true'} ;;
  *"site-create.js"*) printf '${SITE_ID}\\r\\n' ;;
  *"user-create.js"*) echo "Создан владелец" ;;
  *) exit 0 ;;
esac`,
  )
  return { bin, log, chmodLog }
}

type Run = { status: number | null; stdout: string; stderr: string; output: string }

function install(args: string[], options: { fakes?: Fakes; env?: Record<string, string> } = {}) {
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
  return { ...run, calls, chmods, systemd, systemctl }
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
      SITE_ID: '',
    })
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
    expect(notPrivate).toEqual([])
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
      'docker compose exec -T api node dist/server/site-create.js --name example.ru --print-id',
      'docker compose up -d',
    ])
    // Пароль владельца и токен GHCR — не в аргументах команд: пароль приходит переменной окружения
    expect(run.calls()).not.toMatch(/docker [^|]*очень-секретный-пароль/)
    expect(run.calls()).not.toContain('ghp_тестовый')
    expect(calls.find((line) => line.includes('user-create'))).toContain(
      'CMS_USER_PASSWORD=очень-секретный-пароль',
    )
    expect(readEnv(dir)).toMatchObject({ OWNER_EMAIL: 'studio@example.com', SITE_ID })
    expect(run.stdout).toContain('Админка: https://admin.example.ru')
    // Скрипт управления и папки бэкапов и состояния — в папке установки, таймер бэкапов — в systemd
    expect(readFileSync(join(dir, 'averra.sh'), 'utf8')).toBe(
      readFileSync(fileURLToPath(new URL('../averra.sh', import.meta.url)), 'utf8'),
    )
    expect(existsSync(join(dir, 'backups'))).toBe(true)
    expect(existsSync(join(dir, 'state'))).toBe(true)
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'averra.sh')).mode & 0o777).toBe(0o700)
      expect(statSync(join(dir, 'backups')).mode & 0o777).toBe(0o700)
    }
    const service = readFileSync(join(run.systemd, 'averra-backup.service'), 'utf8')
    expect(service).toContain(`ExecStart=${posix(dir)}/averra.sh backup --kind scheduled`)
    expect(readFileSync(join(run.systemd, 'averra-backup.timer'), 'utf8')).toContain(
      'Persistent=true',
    )
    expect(run.systemctl()).toBe('daemon-reload\nenable --now averra-backup.timer\n')
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

  it('повторный запуск владельца и сайт второй раз не создаёт, порты занятые своим Caddy — не помеха', () => {
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
    expect(needed).toEqual(['averra.sh', 'compose.yaml', 'install.sh'])
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
      /^COPY deploy\/compose\.yaml deploy\/averra\.sh deploy\/$/m,
    )
    expect(service('api')).toContain('- ./state:/data/state:ro')
    expect(service('api')).toContain('STATE_DIR: /data/state')
    expect(compose).not.toContain('backups')
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
    // header выполняется раньше try_files и видит исходный путь: матчер по /index.html не сработал бы
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

  it('сайт: immutable только у файлов Astro и картинок /media/<uuid>/, страница media — no-cache', () => {
    const site = siteBlock('{$SITE_DOMAIN}')
    const immutable = /@immutable path_regexp (\S+)/.exec(site)?.[1]
    const pages = /@pages not path_regexp (\S+)/.exec(site)?.[1]
    expect(immutable).toBeDefined()
    // Страницы — ровно то, что не immutable
    expect(pages).toBe(immutable)
    // Синтаксис RE2 в Caddy здесь тот же, что у RegExp
    const re = new RegExp(immutable ?? '')
    expect(re.test('/_astro/index.Bx1.css')).toBe(true)
    expect(re.test('/media/c6026fd5-5af8-4af9-a36e-1e08b05210a8/640.webp')).toBe(true)
    expect(re.test('/media/')).toBe(false)
    expect(re.test('/media/index.html')).toBe(false)
    expect(re.test('/')).toBe(false)
    expect(re.test('/o-nas/')).toBe(false)
  })
})
