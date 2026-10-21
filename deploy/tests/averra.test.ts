import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bash, pathEntry, posix, tempDir } from './bash'

// Скрипт управления установкой deploy/averra.sh без Docker: настоящий bash, а docker, flock,
// sleep — подделки первыми в PATH. Подделка docker ведёт маленький «сервер»: базы — файлы с числом
// применённых миграций, запущенная версия API, здоровье по версии. Так проверяются решения скрипта
// по итогам шагов (бэкап, проверка, откат), а не сам Docker — он в чек-листе живой проверки
// (документация: Установка и сопровождение → Чек-лист живой проверки)

const script = fileURLToPath(new URL('../averra.sh', import.meta.url))

type Fakes = {
  /** compose pull падает */
  pullFails?: boolean
  /** pg_dump падает */
  dumpFails?: boolean
  /** pg_restore в эту базу падает (averra_verify — проверка бэкапа, averra_restore — восстановление) */
  restoreFailsInto?: string
  /** Эти версии API не отвечают на /api/health/ready */
  unhealthy?: string[]
  /** Запуск этой версии применяет новую миграцию */
  migratesOn?: string
  /** Архив медиатеки битый */
  badMedia?: boolean
  /** В образе нет compose.yaml и averra.sh */
  noDeployFiles?: boolean
  /** rclone copy падает */
  rcloneFails?: boolean
  /** Что лежит во внешнем хранилище (rclone lsf) */
  remote?: string[]
  /** rclone lsf падает */
  lsfFails?: boolean
  /** rclone purge падает */
  purgeFails?: boolean
  /** У этих версий Caddy не держится в running (ошибка в Caddyfile, битый образ) */
  caddyDown?: string[]
  /** Процесс обновления убивается (kill -9) на первом вызове docker, подходящем под это регулярное выражение (часто — просто подстрока) */
  killOn?: string
  /** Переименование этих баз падает (ALTER DATABASE <имя> RENAME …) */
  renameFailsFrom?: string[]
  /** Чем отвязывать процесс обновления (по умолчанию setsid: systemd на машине тестов нет) */
  detach?: 'systemd-run'
  /** Вывод команды идёт в канал, который закрывается после стольких строк (обрыв SSH, Ctrl+C) */
  headLines?: number
  /** Замок .averra.lock занят: идёт бэкап, восстановление или другое обновление */
  lockHeld?: boolean
  /** Скрипт sh из контейнера API с этой подстрокой выполняется, но кончается сбоем */
  shFailsOn?: string
  /** Перенос этой записи тома медиатеки в .averra-before-restore падает (кончилось место) */
  mvFailsOn?: string
  /** Возврат этой записи из .averra-before-restore в корень тома падает */
  mvBackFailsOn?: string
}

/**
 * systemd-run: запоминает аргументы и запускает команду в фоне с выводом в файл из StandardOutput.
 * Как настоящий, не ждёт конца команды
 */
const FAKE_SYSTEMD_RUN = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_STATE/systemd-run.log"
log=''
while [[ $# -gt 0 && "$1" == -* ]]; do
  case "$1" in
    --property=StandardOutput=append:*) log="\${1#--property=StandardOutput=append:}" ;;
    --setenv=*) export "\${1#--setenv=}" ;;
  esac
  shift
done
"$@" </dev/null >>"$log" 2>&1 &
`

/**
 * mv: перенос записи с именем FAKE_MV_FAILS_ON в .averra-before-restore падает (кончилось место),
 * возврат записи FAKE_MV_BACK_FAILS_ON из неё в корень тома — тоже; остальные записи той же
 * команды переносятся. Всё прочее — настоящий mv
 */
const FAKE_MV = `#!/usr/bin/env bash
broken=''
[[ "$1 $2" != "-t .averra-before-restore" ]] || broken="\${FAKE_MV_FAILS_ON:-}"
[[ "$1 $2" != "-t ." ]] || broken="\${FAKE_MV_BACK_FAILS_ON:-}"
if [[ -n "$broken" ]]; then
  dir="$2"
  shift 2
  code=0
  for source in "$@"; do
    if [[ "\${source##*/}" == "$broken" ]]; then
      echo "mv: cannot move '$source': No space left on device" >&2
      code=1
    else
      /usr/bin/mv -t "$dir" "$source" || code=$?
    fi
  done
  exit $code
fi
exec /usr/bin/mv "$@"
`

const FAKE_DOCKER = readFileSync(
  fileURLToPath(new URL('./fake-docker.sh', import.meta.url)),
  'utf8',
)

const BASE_ENV = [
  'AVERRA_VERSION=0.6.0',
  'AVERRA_API_IMAGE=ghcr.io/midhey/averra-api',
  'SITE_DOMAIN=example.ru',
  'BACKUP_PASSPHRASE=парольшифрованиябэкапов',
]

/** Папка установки, как её оставляет install.sh: averra.sh, compose.yaml, .env, состояние */
function server(options: { env?: string[]; migrations?: number } = {}) {
  const root = tempDir('averra-server')
  const dir = join(root, 'averra')
  const fake = join(root, 'fake')
  const bin = join(root, 'bin')
  // Тома media и sites: по ним по-настоящему ходят tar и sh «контейнера» API
  const volumes = [join(fake, 'data', 'media', 'site'), join(fake, 'data', 'sites')]
  for (const path of [dir, fake, bin, ...volumes]) {
    mkdirSync(path, { recursive: true })
  }
  copyFileSync(script, join(dir, 'averra.sh'))
  writeFileSync(join(dir, 'compose.yaml'), '# compose прежний\n')
  writeFileSync(join(dir, '.env'), `${[...BASE_ENV, ...(options.env ?? [])].join('\n')}\n`)
  writeFileSync(join(fake, 'db-averra'), `${options.migrations ?? 15}\n`)
  writeFileSync(join(fake, 'running'), '0.6.0\n')
  writeFileSync(join(fake, 'data', 'media', 'site', 'original.jpg'), 'картинка')
  const write = (name: string, body: string) => {
    writeFileSync(join(bin, name), body)
    chmodSync(join(bin, name), 0o755)
  }
  write('docker', FAKE_DOCKER)
  write('flock', '#!/usr/bin/env bash\n[[ -z "$FAKE_LOCKED" ]] || exit 1\n')
  write('sleep', '#!/usr/bin/env bash\nexit 0\n')
  // setsid есть на любом Linux, в Git Bash его нет: здесь процесс просто уходит в фон
  write('setsid', '#!/usr/bin/env bash\nexec "$@"\n')
  write('systemd-run', FAKE_SYSTEMD_RUN)
  write('mv', FAKE_MV)

  function run(args: string[], fakes: Fakes = {}) {
    const inBash = fakes.headLines
      ? `PATH="$AVERRA_FAKE_BIN:$PATH"; bash "$@" | head -n ${fakes.headLines}; exit \${PIPESTATUS[0]}`
      : 'PATH="$AVERRA_FAKE_BIN:$PATH" exec bash "$@"'
    const env: Record<string, string> = {
      ...process.env,
      AVERRA_FAKE_BIN: pathEntry(bin),
      FAKE_STATE: posix(fake),
      AVERRA_READY_TIMEOUT: '6',
    }
    if (fakes.pullFails) env.FAKE_PULL_FAILS = '1'
    if (fakes.dumpFails) env.FAKE_DUMP_FAILS = '1'
    if (fakes.restoreFailsInto) env.FAKE_RESTORE_FAILS_INTO = fakes.restoreFailsInto
    if (fakes.unhealthy) env.FAKE_UNHEALTHY = fakes.unhealthy.join(' ')
    if (fakes.migratesOn) env.FAKE_MIGRATES_ON = fakes.migratesOn
    if (fakes.badMedia) env.FAKE_BAD_MEDIA = '1'
    if (fakes.noDeployFiles) env.FAKE_NO_DEPLOY_FILES = '1'
    if (fakes.rcloneFails) env.FAKE_RCLONE_FAILS = '1'
    if (fakes.remote) env.FAKE_REMOTE = fakes.remote.join(' ')
    if (fakes.lsfFails) env.FAKE_LSF_FAILS = '1'
    if (fakes.purgeFails) env.FAKE_PURGE_FAILS = '1'
    if (fakes.caddyDown) env.FAKE_CADDY_DOWN = fakes.caddyDown.join(' ')
    if (fakes.killOn) env.FAKE_KILL_ON = fakes.killOn
    if (fakes.renameFailsFrom) env.FAKE_RENAME_FAILS_FROM = fakes.renameFailsFrom.join(' ')
    if (fakes.detach) env.AVERRA_DETACH = fakes.detach
    if (fakes.lockHeld) env.FAKE_LOCKED = '1'
    if (fakes.shFailsOn) env.FAKE_SH_FAILS_ON = fakes.shFailsOn
    if (fakes.mvFailsOn) env.FAKE_MV_FAILS_ON = fakes.mvFailsOn
    if (fakes.mvBackFailsOn) env.FAKE_MV_BACK_FAILS_ON = fakes.mvBackFailsOn
    // Запуск не от терминала: скрипт ничего не спрашивает
    const result = spawnSync(bash, ['-c', inBash, 'bash', posix(join(dir, 'averra.sh')), ...args], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      output: result.stdout + result.stderr,
    }
  }

  const calls = () =>
    (existsSync(join(fake, 'calls.log')) ? readFileSync(join(fake, 'calls.log'), 'utf8') : '')
      .replace(/--project-directory \S+ /g, '')
      .split('\n')
      .filter(Boolean)
  const state = (file: string) => JSON.parse(readFileSync(join(dir, 'state', file), 'utf8'))
  const backups = () =>
    existsSync(join(dir, 'backups')) ? readdirSync(join(dir, 'backups')).sort() : []
  const migrations = (db = 'averra') => readFileSync(join(fake, `db-${db}`), 'utf8').trim()
  const env = () => readFileSync(join(dir, '.env'), 'utf8')
  const clearCalls = () => writeFileSync(join(fake, 'calls.log'), '')
  /** Дождаться конца процесса обновления: его итог — код в .update-exit */
  function waitWorker() {
    const exit = join(dir, '.update-exit')
    const until = Date.now() + 60_000
    while (!existsSync(exit)) {
      if (Date.now() > until) throw new Error('процесс обновления не кончился за минуту')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
    return Number(readFileSync(exit, 'utf8').trim())
  }
  const running = () => readFileSync(join(fake, 'running'), 'utf8').trim()
  const mediaRoot = join(fake, 'data', 'media')
  /** Файлы в томе медиатеки (и в служебных папках .averra-*), пути через «/» */
  const media = () =>
    readdirSync(mediaRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => posix(relative(mediaRoot, join(entry.parentPath, entry.name))))
      .sort()
  /** Запуски API и картинки в медиатеке в ту минуту: из них API собирает сайты */
  const builds = () =>
    (existsSync(join(fake, 'builds.log')) ? readFileSync(join(fake, 'builds.log'), 'utf8') : '')
      .split('\n')
      .filter(Boolean)
  return {
    dir,
    fake,
    run,
    calls,
    state,
    backups,
    migrations,
    env,
    clearCalls,
    waitWorker,
    running,
    media,
    builds,
  }
}

const BACKUP_NAME = /^\d{8}-\d{6}-(manual|scheduled|pre-update)$/

/** Время days дней назад в формате имени бэкапа (UTC): срок хранения считается от сейчас */
function stampAgo(days: number) {
  const iso = new Date(Date.now() - days * 24 * 3_600_000).toISOString()
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`
}

describe('бэкап', () => {
  it('дамп, архив медиа, проверка восстановлением во временную базу, манифест и состояние', () => {
    const srv = server()
    const run = srv.run(['backup'])
    expect(run.status, run.output).toBe(0)
    const [name] = srv.backups()
    expect(name).toMatch(BACKUP_NAME)
    expect(name).toMatch(/-manual$/)
    const files = readdirSync(join(srv.dir, 'backups', name ?? '')).sort()
    expect(files).toEqual(['SHA256SUMS', 'db.dump', 'manifest.json', 'media.tar.gz'])
    const manifest = JSON.parse(
      readFileSync(join(srv.dir, 'backups', name ?? '', 'manifest.json'), 'utf8'),
    )
    expect(manifest).toMatchObject({
      name,
      kind: 'manual',
      version: '0.6.0',
      migrations: 15,
      tables: 12,
      verified: true,
    })

    const calls = srv.calls()
    const steps = calls.map((line) => line.replace(/ -U averra/g, ''))
    expect(steps).toEqual([
      'docker compose exec -T postgres pg_dump -d averra -Fc',
      'docker compose exec -T postgres psql -d averra -tAc select count(*) from drizzle.__drizzle_migrations',
      "docker compose exec -T postgres psql -d averra -tAc select count(*) from information_schema.tables where table_schema = 'public'",
      // Медиатека — отдельным контейнером с томом: бэкап не зависит от того, запущен ли API
      'docker compose run --rm --no-deps -T --entrypoint tar api --exclude=media/.averra-* -C /data -czf - media',
      'docker compose exec -T postgres dropdb --if-exists averra_verify',
      'docker compose exec -T postgres createdb averra_verify',
      'docker compose exec -T postgres pg_restore -d averra_verify --no-owner --exit-on-error',
      'docker compose exec -T postgres psql -d averra_verify -tAc select count(*) from drizzle.__drizzle_migrations',
      "docker compose exec -T postgres psql -d averra_verify -tAc select count(*) from information_schema.tables where table_schema = 'public'",
      'docker compose exec -T postgres dropdb --if-exists averra_verify',
      // Срок хранения: базы, отложенные при откате обновления, — только когда рабочая на месте
      "docker compose exec -T postgres psql -d postgres -tAc select count(*) from pg_database where datname = 'averra'",
      "docker compose exec -T postgres psql -d postgres -tAc select datname from pg_database where datname ~ '^averra_(rolled_back|failed_restore)_'",
    ])
    // Временной базы после проверки нет
    expect(existsSync(join(srv.fake, 'db-averra_verify'))).toBe(false)

    const state = srv.state('backup-last.json')
    expect(state).toMatchObject({
      name,
      kind: 'manual',
      ok: true,
      verified: true,
      remote: 'off',
      error: null,
    })
    expect(state.dbBytes).toBeGreaterThan(0)
    expect(state.mediaBytes).toBeGreaterThan(0)
    expect(srv.state('backup-last-ok.json')).toEqual(state)
  })

  it('сбой дампа, проверки или архива — бэкап не удался, неполных файлов нет, прежний удачный остаётся', () => {
    const srv = server()
    expect(srv.run(['backup', '--kind', 'scheduled']).status).toBe(0)
    const good = srv.state('backup-last-ok.json')
    for (const [fakes, error] of [
      [{ dumpFails: true }, 'pg_dump не прошёл: база не ответила'],
      [{ restoreFailsInto: 'averra_verify' }, 'дамп не восстановился во временную базу'],
      [{ badMedia: true }, 'архив медиатеки не читается'],
    ] as const) {
      const run = srv.run(['backup'], fakes)
      expect(run.status, error).toBe(1)
      expect(srv.state('backup-last.json')).toMatchObject({ ok: false, verified: false, error })
      expect(srv.state('backup-last-ok.json')).toEqual(good)
      // Только удачный бэкап, без временных папок с персональными данными
      expect(srv.backups()).toEqual([good.name])
    }
  })

  it('ротация: остаются BACKUP_KEEP последних, временные папки удаляются, новый — всегда', () => {
    const srv = server({ env: ['BACKUP_KEEP=3'] })
    const dir = join(srv.dir, 'backups')
    const [a, b, c, d] = [2.9, 2.5, 2, 1].map((days) => stampAgo(days))
    for (const name of [
      `${a}-scheduled`,
      `${b}-scheduled`,
      `${c}-pre-update`,
      `${d}-scheduled`,
      `.tmp-${d}-scheduled`,
    ]) {
      mkdirSync(join(dir, name), { recursive: true })
    }
    // Чужая папка с непохожим именем не трогается
    mkdirSync(join(dir, 'руками'), { recursive: true })
    const run = srv.run(['backup'])
    expect(run.status, run.output).toBe(0)
    const left = srv.backups()
    expect(left).toHaveLength(4)
    expect(left.slice(0, 2)).toEqual([`${c}-pre-update`, `${d}-scheduled`])
    expect(left[2]).toMatch(/-manual$/)
    expect(left[3]).toBe('руками')
  })

  it('срок хранения (152-ФЗ): старше BACKUP_KEEP дней не хранится, даже если бэкапов мало', () => {
    const srv = server({ env: ['BACKUP_KEEP=7'] })
    const dir = join(srv.dir, 'backups')
    const old = `${stampAgo(7.5)}-scheduled`
    const fresh = `${stampAgo(6.5)}-scheduled`
    for (const name of [old, fresh]) mkdirSync(join(dir, name), { recursive: true })
    // Базы, отложенные при откате обновления: имя несёт время отката
    const stale = `averra_rolled_back_${stampAgo(8).replace('-', '_')}`
    const recent = `averra_rolled_back_${stampAgo(1).replace('-', '_')}`
    // И базы, на которых не поднялся API при восстановлении: в них данные бэкапа
    const staleFailed = `averra_failed_restore_${stampAgo(9).replace('-', '_')}`
    const recentFailed = `averra_failed_restore_${stampAgo(2).replace('-', '_')}`
    for (const db of [stale, recent, staleFailed, recentFailed, 'averra_before_restore']) {
      writeFileSync(join(srv.fake, `db-${db}`), '16\n')
    }
    const run = srv.run(['backup'])
    expect(run.status, run.output).toBe(0)
    expect(srv.backups()).toEqual([fresh, expect.stringMatching(/-manual$/)])
    expect(existsSync(join(srv.fake, `db-${stale}`))).toBe(false)
    expect(existsSync(join(srv.fake, `db-${recent}`))).toBe(true)
    expect(existsSync(join(srv.fake, `db-${staleFailed}`))).toBe(false)
    expect(existsSync(join(srv.fake, `db-${recentFailed}`))).toBe(true)
    // Прежняя рабочая база от неразобранного восстановления — не по сроку: её разбирает человек
    expect(existsSync(join(srv.fake, 'db-averra_before_restore'))).toBe(true)
    expect(run.stdout).toContain(`Удалена база ${stale}: срок хранения (7 дн.) вышел`)
    expect(run.stdout).toContain(`Удалена база ${staleFailed}: срок хранения (7 дн.) вышел`)
  })

  it('базы averra нет (откат кончился rollback-failed) — служебные базы по сроку не удаляются', () => {
    const srv = server({ env: ['BACKUP_KEEP=1'] })
    // Откат оборвался между переименованиями, повтор не вернул имя: рабочие данные — только
    // в отложенной базе, отметки .update-run уже нет. Ночной бэкап падает: базы averra нет
    const kept = `averra_rolled_back_${stampAgo(3).replace('-', '_')}`
    const failed = `averra_failed_restore_${stampAgo(5).replace('-', '_')}`
    rmSync(join(srv.fake, 'db-averra'))
    writeFileSync(join(srv.fake, `db-${kept}`), '16\n')
    writeFileSync(join(srv.fake, `db-${failed}`), '15\n')
    const run = srv.run(['backup'], { dumpFails: true })
    expect(run.status).toBe(1)
    expect(existsSync(join(srv.fake, `db-${kept}`))).toBe(true)
    expect(existsSync(join(srv.fake, `db-${failed}`))).toBe(true)
    expect(run.output).not.toContain('Удалена база')
    expect(run.stdout).toContain('Базы averra нет: служебные базы')

    // Рабочую базу вернули — срок хранения снова действует
    writeFileSync(join(srv.fake, 'db-averra'), '16\n')
    const ok = srv.run(['backup'])
    expect(ok.status, ok.output).toBe(0)
    expect(existsSync(join(srv.fake, `db-${kept}`))).toBe(false)
  })

  it('бэкапы падают — старые копии всё равно уходят по сроку', () => {
    const srv = server({ env: ['BACKUP_KEEP=3'] })
    const dir = join(srv.dir, 'backups')
    const old = `${stampAgo(4)}-scheduled`
    const fresh = `${stampAgo(1)}-scheduled`
    for (const name of [old, fresh]) mkdirSync(join(dir, name), { recursive: true })
    const run = srv.run(['backup'], { dumpFails: true })
    expect(run.status).toBe(1)
    expect(srv.backups()).toEqual([fresh])
  })

  it('кривой BACKUP_KEEP — отказ до бэкапа, причина видна в состоянии сразу', () => {
    const srv = server({ env: ['BACKUP_KEEP=0'] })
    const run = srv.run(['backup'])
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('BACKUP_KEEP=0 в .env — число от 1 до 365')
    expect(srv.calls()).toEqual([])
    expect(srv.state('backup-last.json')).toMatchObject({
      ok: false,
      kind: 'manual',
      error: 'BACKUP_KEEP в .env неверный: нужно число от 1 до 365',
    })
  })

  it('API лежит — бэкап всё равно делается: медиатека из тома, без запущенного API', () => {
    const srv = server()
    writeFileSync(join(srv.fake, 'running'), 'stopped\n')
    const run = srv.run(['backup'])
    expect(run.status, run.output).toBe(0)
    expect(srv.state('backup-last.json')).toMatchObject({ ok: true })
  })

  it('служебные папки восстановления (media/.averra-*) в архив медиатеки не попадают', () => {
    const srv = server()
    const media = join(srv.fake, 'data', 'media')
    mkdirSync(join(media, '.averra-before-restore', 'site'), { recursive: true })
    writeFileSync(join(media, '.averra-before-restore', 'site', 'old.jpg'), 'прежняя')
    mkdirSync(join(media, '.averra-restore', 'media', 'site'), { recursive: true })
    writeFileSync(join(media, '.averra-restore', 'media', 'site', 'staged.jpg'), 'из бэкапа')
    const run = srv.run(['backup'])
    expect(run.status, run.output).toBe(0)
    const [name = ''] = srv.backups()
    // tar Git Bash считает «C:» в пути к архиву именем хоста: читаем из папки бэкапа
    const list = spawnSync(
      bash,
      ['-c', 'cd "$1" && tar -tzf media.tar.gz', 'bash', posix(join(srv.dir, 'backups', name))],
      {
        encoding: 'utf8',
      },
    )
    expect(list.status, list.stderr).toBe(0)
    expect(list.stdout).toContain('media/site/original.jpg')
    expect(list.stdout).not.toContain('.averra')
  })

  it('бэкап посреди незавершённого обновления не удаляет его бэкап и отложенную базу: из них откатывает повтор', () => {
    const srv = server({ env: ['BACKUP_KEEP=1'] })
    const dir = join(srv.dir, 'backups')
    const pending = `${stampAgo(3)}-pre-update`
    const older = `${stampAgo(4)}-scheduled`
    for (const name of [older, pending]) mkdirSync(join(dir, name), { recursive: true })
    const kept = `averra_rolled_back_${stampAgo(3).replace('-', '_')}`
    writeFileSync(join(srv.fake, `db-${kept}`), '16\n')
    // Обновление оборвалось посреди отката (перезагрузка), таймер сделал бэкап при старте сервера
    writeFileSync(
      join(srv.dir, '.update-run'),
      `FROM=0.6.0\nTO=0.7.0\nPHASE=rollback\nBEFORE=15\nBACKUP=${pending}\nKEPT=${kept}\n`,
    )
    const run = srv.run(['backup', '--kind', 'scheduled'])
    expect(run.status, run.output).toBe(0)
    expect(srv.backups()).toEqual([pending, expect.stringMatching(/-scheduled$/)])
    expect(existsSync(join(srv.fake, `db-${kept}`))).toBe(true)
    // Обновление доведено — дальше срок хранения как обычно
    rmSync(join(srv.dir, '.update-run'))
    expect(srv.run(['backup']).status).toBe(0)
    expect(srv.backups()).toEqual([expect.stringMatching(/-manual$/)])
    expect(existsSync(join(srv.fake, `db-${kept}`))).toBe(false)
  })
})

describe('внешнее хранилище', () => {
  const s3 = [
    'BACKUP_S3_BUCKET=studio-backups',
    'BACKUP_S3_ACCESS_KEY_ID=YCAJE-ключ',
    'BACKUP_S3_SECRET_ACCESS_KEY=YCP-секрет-хранилища',
  ]

  it('копия шифруется (crypt), секреты — переменными окружения, лишнее в хранилище удаляется', () => {
    const srv = server({ env: [...s3, 'BACKUP_KEEP=2'] })
    const [a, b, c] = [1.5, 1, 0.5].map((days) => `${stampAgo(days)}-scheduled`)
    const run = srv.run(['backup'], { remote: [`${a}/`, `${b}/`, `${c}/`] })
    expect(run.status, run.output).toBe(0)
    const [name] = srv.backups()
    const calls = srv.calls()
    const text = calls.join('\n')
    // Ни ключ, ни пароль шифрования не попали в аргументы docker
    expect(text).not.toContain('YCP-секрет-хранилища')
    expect(text).not.toContain('парольшифрованиябэкапов')
    expect(text).toContain('secret-on-stdin=yes')
    // В контейнер они ушли переменными (-e без значения), пароль — «затемнённым»
    expect(text).toContain('rclone-env key=YCAJE-ключ secret=set password=OBSCURED')
    const copy = calls.find((line) => line.includes(' copy '))
    expect(copy).toContain(`/backups/${name}:/backup:ro`)
    expect(copy).toContain('-e RCLONE_CONFIG_AVERRAS3_SECRET_ACCESS_KEY ')
    expect(copy).toContain('-e RCLONE_CONFIG_AVERRA_TYPE=crypt')
    expect(copy).toContain(
      '-e RCLONE_CONFIG_AVERRA_REMOTE=averras3:studio-backups/averra/example.ru',
    )
    expect(copy).toContain(`copy /backup averra:${name}`)
    // В хранилище было 3 + новый, хранится 2: удалены два самых старых
    const purged = calls
      .filter((line) => line.includes(' purge '))
      .map((line) => line.split(' ').at(-1))
    expect(purged).toEqual([`averra:${a}`, `averra:${b}`])
    expect(srv.state('backup-last.json')).toMatchObject({ ok: true, remote: 'uploaded' })
  })

  it('в хранилище тоже срок: копии старше BACKUP_KEEP дней удаляются, хоть их и мало', () => {
    const srv = server({ env: [...s3, 'BACKUP_KEEP=7'] })
    const old = `${stampAgo(8)}-scheduled`
    const fresh = `${stampAgo(2)}-scheduled`
    const run = srv.run(['backup'], { remote: [`${old}/`, `${fresh}/`] })
    expect(run.status, run.output).toBe(0)
    const purged = srv
      .calls()
      .filter((line) => line.includes(' purge '))
      .map((line) => line.split(' ').at(-1))
    expect(purged).toEqual([`averra:${old}`])
  })

  it('чистка хранилища не прошла — копия выгружена, но это видно в состоянии (cleanup-failed)', () => {
    for (const fakes of [{ lsfFails: true }, { purgeFails: true }]) {
      const srv = server({ env: [...s3, 'BACKUP_KEEP=1'] })
      const run = srv.run(['backup'], { ...fakes, remote: [`${stampAgo(3)}-scheduled/`] })
      expect(run.status, run.output).toBe(0)
      expect(run.stdout).toContain('старые копии там не удалились')
      expect(srv.state('backup-last.json')).toMatchObject({ ok: true, remote: 'cleanup-failed' })
    }
  })

  it('бэкап не удался — хранилище чистится по сроку всё равно, сбой чистки виден', () => {
    const srv = server({ env: [...s3, 'BACKUP_KEEP=2'] })
    const old = `${stampAgo(5)}-scheduled`
    const failed = srv.run(['backup'], { dumpFails: true, remote: [`${old}/`] })
    expect(failed.status).toBe(1)
    expect(srv.calls().some((line) => line.endsWith(` purge averra:${old}`))).toBe(true)
    expect(srv.state('backup-last.json')).toMatchObject({ ok: false, remote: 'off' })
    const broken = srv.run(['backup'], { dumpFails: true, lsfFails: true })
    expect(broken.status).toBe(1)
    expect(srv.state('backup-last.json')).toMatchObject({ ok: false, remote: 'cleanup-failed' })
  })

  it('сбой выгрузки — бэкап удачный (локальный проверен), но копия видна как не выгрузившаяся', () => {
    const srv = server({ env: s3 })
    const run = srv.run(['backup'], { rcloneFails: true })
    expect(run.status, run.output).toBe(0)
    expect(srv.state('backup-last.json')).toMatchObject({ ok: true, remote: 'failed' })
    expect(srv.state('backup-last-ok.json')).toMatchObject({ remote: 'failed' })
  })
})

describe('обновление', () => {
  it('удачное: образы, конфигурация из образа, API стоит на время бэкапа, новая версия, Caddy, новый averra.sh', () => {
    const srv = server()
    const run = srv.run(['update', '--version', '0.7.0', '--yes'], { migratesOn: '0.7.0' })
    expect(run.status, run.output).toBe(0)
    const calls = srv
      .calls()
      .filter((line) => !/postgres (psql|dropdb|createdb|pg_restore)/.test(line))
    expect(calls).toEqual([
      'docker compose pull api caddy',
      'docker run --rm --entrypoint cat ghcr.io/midhey/averra-api:0.7.0 /app/deploy/compose.yaml',
      'docker run --rm --entrypoint cat ghcr.io/midhey/averra-api:0.7.0 /app/deploy/averra.sh',
      // Прежний API остановлен до дампа: всё, что он принял, есть в бэкапе
      'docker compose stop api',
      'docker compose exec -T postgres pg_dump -U averra -d averra -Fc',
      'docker compose run --rm --no-deps -T --entrypoint tar api --exclude=media/.averra-* -C /data -czf - media',
      'docker compose up -d api',
      'compose.yaml=# compose ghcr.io/midhey/averra-api:0.7.0',
      expect.stringMatching(/^docker compose exec -T api node -e fetch/),
      'docker compose up -d',
      'compose.yaml=# compose ghcr.io/midhey/averra-api:0.7.0',
      expect.stringMatching(/^docker compose exec -T api node -e fetch/),
      // И API, и Caddy держатся в running — дважды с паузой
      'docker compose ps --status running --services',
      'docker compose ps --status running --services',
    ])
    expect(srv.env()).toMatch(/^AVERRA_VERSION=0\.7\.0$/m)
    expect(srv.env()).toMatch(/^AVERRA_PREVIOUS_VERSION=0\.6\.0$/m)
    expect(srv.migrations()).toBe('16')
    expect(readFileSync(join(srv.dir, 'compose.yaml.prev'), 'utf8')).toBe('# compose прежний\n')
    expect(readFileSync(join(srv.dir, 'averra.sh'), 'utf8')).toContain(
      'averra.sh ghcr.io/midhey/averra-api:0.7.0',
    )
    expect(existsSync(join(srv.dir, '.next'))).toBe(false)
    expect(srv.backups()[0]).toMatch(/-pre-update$/)
    expect(srv.state('update-last.json')).toMatchObject({
      from: '0.6.0',
      to: '0.7.0',
      result: 'updated',
      dbRestored: false,
      keptDatabase: null,
      error: null,
    })
    // Состояние бэкапа записано после обновления (внешняя копия — тоже после)
    expect(srv.state('backup-last-ok.json').name).toBe(srv.backups()[0])
  })

  it('внешняя копия бэкапа перед обновлением выгружается после запуска новой версии', () => {
    const srv = server({
      env: [
        'BACKUP_S3_BUCKET=studio-backups',
        'BACKUP_S3_ACCESS_KEY_ID=YCAJE-ключ',
        'BACKUP_S3_SECRET_ACCESS_KEY=YCP-секрет-хранилища',
      ],
    })
    const run = srv.run(['update', '--version', '0.7.0', '--yes'])
    expect(run.status, run.output).toBe(0)
    const calls = srv.calls()
    const upload = calls.findIndex((line) => line.includes(' copy /backup '))
    const lastUp = calls.findLastIndex((line) => line.startsWith('docker compose up -d'))
    expect(upload).toBeGreaterThan(lastUp)
    expect(srv.state('backup-last.json')).toMatchObject({ kind: 'pre-update', remote: 'uploaded' })
  })

  it('уже эта версия — ничего не делает', () => {
    const srv = server()
    const run = srv.run(['update', '--version', '0.6.0'])
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('Уже версия 0.6.0')
    expect(srv.calls()).toEqual([])
  })

  it('не скачались образы или нет конфигурации в образе — ничего не менялось', () => {
    for (const fakes of [{ pullFails: true }, { noDeployFiles: true }]) {
      const srv = server()
      const run = srv.run(['update', '--version', '0.7.0', '--yes'], fakes)
      expect(run.status).toBe(1)
      expect(run.output).toContain('ничего не менялось')
      expect(srv.env()).toMatch(/^AVERRA_VERSION=0\.6\.0$/m)
      expect(srv.calls().join('\n')).not.toMatch(/up -d|pg_dump|stop api/)
      expect(srv.backups()).toEqual([])
      expect(srv.state('update-last.json')).toMatchObject({ result: 'failed', dbRestored: false })
    }
  })

  it('не удался бэкап перед обновлением — не обновляем, прежняя версия снова запущена', () => {
    const srv = server()
    const run = srv.run(['update', '--version', '0.7.0', '--yes'], { dumpFails: true })
    expect(run.status).toBe(1)
    expect(run.output).toContain('бэкап перед обновлением не удался, ничего не менялось')
    expect(srv.env()).toMatch(/^AVERRA_VERSION=0\.6\.0$/m)
    expect(readFileSync(join(srv.dir, 'compose.yaml'), 'utf8')).toBe('# compose прежний\n')
    const ups = srv.calls().filter((line) => line.startsWith('compose.yaml='))
    expect(ups).toEqual(['compose.yaml=# compose прежний'])
    expect(readFileSync(join(srv.fake, 'running'), 'utf8').trim()).toBe('0.6.0')
    expect(srv.state('update-last.json')).toMatchObject({
      result: 'failed',
      error: 'бэкап перед обновлением не удался',
    })
  })

  it('новая версия не готова, миграций не было — откат образа без восстановления базы', () => {
    const srv = server()
    const run = srv.run(['update', '--version', '0.7.0', '--yes'], { unhealthy: ['0.7.0'] })
    expect(run.status).toBe(1)
    expect(run.output).toContain('работает прежняя версия 0.6.0')
    expect(srv.env()).toMatch(/^AVERRA_VERSION=0\.6\.0$/m)
    expect(readFileSync(join(srv.dir, 'compose.yaml'), 'utf8')).toBe('# compose прежний\n')
    expect(srv.calls().join('\n')).not.toContain('averra_restore')
    // Последним поднят прежний API с прежним compose.yaml
    expect(
      srv
        .calls()
        .filter((line) => line.startsWith('compose.yaml='))
        .at(-1),
    ).toBe('compose.yaml=# compose прежний')
    expect(readFileSync(join(srv.fake, 'running'), 'utf8').trim()).toBe('0.6.0')
    // Скрипт не заменён на новую версию
    expect(readFileSync(join(srv.dir, 'averra.sh'), 'utf8')).toBe(readFileSync(script, 'utf8'))
    expect(srv.state('update-last.json')).toMatchObject({
      result: 'rolled-back',
      dbRestored: false,
      keptDatabase: null,
    })
  })

  it('новая версия не готова после миграций — база из бэкапа, а данные после бэкапа не пропадают', () => {
    const srv = server()
    const run = srv.run(['update', '--version', '0.7.0', '--yes'], {
      unhealthy: ['0.7.0'],
      migratesOn: '0.7.0',
    })
    expect(run.status).toBe(1)
    expect(run.output).toContain('Миграции новой версии успели примениться (15 → 16)')
    // База — снова с 15 миграциями: из дампа, через averra_restore и переименование
    expect(srv.migrations()).toBe('15')
    const text = srv.calls().join('\n')
    expect(text).toContain('pg_restore -U averra -d averra_restore')
    expect(text).toContain('ALTER DATABASE averra_restore RENAME TO averra')
    // Прежняя рабочая база (с тем, что новая версия успела принять) не удалена, а отложена
    const kept = readdirSync(srv.fake).filter((name) => name.startsWith('db-averra_rolled_back_'))
    expect(kept).toHaveLength(1)
    const keptName = (kept[0] ?? '').replace(/^db-/, '')
    expect(keptName).toMatch(/^averra_rolled_back_\d{8}_\d{6}$/)
    expect(srv.migrations(keptName)).toBe('16')
    expect(text).toContain(`ALTER DATABASE averra RENAME TO ${keptName}`)
    expect(text).not.toMatch(/dropdb .*averra_rolled_back_/)
    expect(text).not.toContain('averra_before_restore')
    // Человек узнаёт, где эти данные: в выводе и в состоянии
    expect(run.stdout).toContain(`— в базе ${keptName}`)
    expect(srv.env()).toMatch(/^AVERRA_VERSION=0\.6\.0$/m)
    expect(srv.state('update-last.json')).toMatchObject({
      result: 'rolled-back',
      dbRestored: true,
      keptDatabase: keptName,
    })
  })

  it('Caddy новой версии не держится — откат, хотя API готов', () => {
    const srv = server()
    const run = srv.run(['update', '--version', '0.7.0', '--yes'], {
      caddyDown: ['0.7.0'],
      migratesOn: '0.7.0',
    })
    expect(run.status, run.output).toBe(1)
    expect(run.output).toContain('работает прежняя версия 0.6.0')
    expect(srv.env()).toMatch(/^AVERRA_VERSION=0\.6\.0$/m)
    // Новая версия успела поработать с базой: она отложена, а не удалена
    expect(srv.state('update-last.json')).toMatchObject({
      result: 'rolled-back',
      dbRestored: true,
      keptDatabase: expect.stringMatching(/^averra_rolled_back_/),
    })
    expect(readFileSync(join(srv.dir, 'averra.sh'), 'utf8')).toBe(readFileSync(script, 'utf8'))
  })

  it('откат не удался — код 2 и состояние «нужен человек»', () => {
    const srv = server()
    const unhealthy = srv.run(['update', '--version', '0.7.0', '--yes'], {
      unhealthy: ['0.7.0', '0.6.0'],
    })
    expect(unhealthy.status).toBe(2)
    expect(unhealthy.output).toContain('откат не удался')
    expect(srv.state('update-last.json')).toMatchObject({ result: 'rollback-failed' })

    const srv2 = server()
    const noRestore = srv2.run(['update', '--version', '0.7.0', '--yes'], {
      unhealthy: ['0.7.0'],
      migratesOn: '0.7.0',
      restoreFailsInto: 'averra_restore',
    })
    expect(noRestore.status).toBe(2)
    expect(noRestore.output).toContain('averra.sh restore')
    expect(srv2.state('update-last.json')).toMatchObject({
      result: 'rollback-failed',
      dbRestored: false,
    })
    // Рабочая база не тронута: восстановление не встало
    expect(srv2.migrations()).toBe('16')
  })

  it('откат сначала останавливает новый API, потом считает миграции', () => {
    const srv = server()
    const run = srv.run(['update', '--version', '0.7.0', '--yes'], {
      unhealthy: ['0.7.0'],
      migratesOn: '0.7.0',
    })
    expect(run.status).toBe(1)
    const calls = srv.calls()
    // После запуска новой версии: первая остановка API — раньше первого подсчёта миграций
    const started = calls.indexOf('compose.yaml=# compose ghcr.io/midhey/averra-api:0.7.0')
    const after = (match: (line: string) => boolean) =>
      calls.findIndex((line, index) => index > started && match(line))
    const stop = after((line) => line.endsWith('compose stop api'))
    const count = after((line) =>
      line.includes('-d averra -tAc select count(*) from drizzle.__drizzle_migrations'),
    )
    expect(started).toBeGreaterThan(-1)
    expect(stop).toBeGreaterThan(started)
    expect(stop).toBeLessThan(count)
  })

  it('обновление — отдельным процессом с логом: отметки хода после него не остаётся', () => {
    const srv = server()
    const run = srv.run(['update', '--version', '0.7.0', '--yes'])
    expect(run.status, run.output).toBe(0)
    expect(run.stdout).toContain('Обновление идёт в фоне на сервере')
    // Ход обновления пришёл из лога процесса
    expect(run.stdout).toContain('Готово: версия 0.7.0')
    expect(readFileSync(join(srv.dir, 'update.log'), 'utf8')).toContain('Готово: версия 0.7.0')
    expect(existsSync(join(srv.dir, '.update-run'))).toBe(false)
    expect(readFileSync(join(srv.dir, '.update-exit'), 'utf8').trim()).toBe('0')
  })

  it('systemd-run: процесс — transient-службой с выводом в update.log', () => {
    const srv = server()
    const run = srv.run(['update', '--version', '0.7.0', '--yes'], { detach: 'systemd-run' })
    expect(run.status, run.output).toBe(0)
    const args = readFileSync(join(srv.fake, 'systemd-run.log'), 'utf8')
    expect(args).toMatch(/--unit=averra-update-\d{8}-\d{6}/)
    expect(args).toContain('--collect')
    expect(args).toContain('--setenv=AVERRA_READY_TIMEOUT=6')
    expect(args).toMatch(/--property=StandardOutput=append:\S+\/averra\/update\.log /)
    expect(args).toContain('averra.sh update-worker --version 0.7.0')
    expect(srv.running()).toBe('0.7.0')
  })

  describe('обрыв посреди обновления', () => {
    it('закрытый канал вывода (обрыв SSH, Ctrl+C) не останавливает обновление', () => {
      const srv = server()
      const run = srv.run(['update', '--version', '0.7.0', '--yes'], {
        migratesOn: '0.7.0',
        headLines: 4,
      })
      // Сама команда умерла от закрытого канала, а процесс обновления доработал
      expect(run.stdout.trimEnd().split('\n').length).toBeLessThanOrEqual(4)
      expect(srv.waitWorker()).toBe(0)
      expect(srv.running()).toBe('0.7.0')
      expect(srv.env()).toMatch(/^AVERRA_VERSION=0\.7\.0$/m)
      expect(srv.state('update-last.json')).toMatchObject({ result: 'updated' })
      expect(srv.state('backup-last-ok.json').kind).toBe('pre-update')
      expect(existsSync(join(srv.dir, '.update-run'))).toBe(false)
      expect(existsSync(join(srv.dir, '.next'))).toBe(false)
    })

    it('то же при неготовой версии с миграцией: откат и восстановление базы доходят до конца', () => {
      const srv = server()
      srv.run(['update', '--version', '0.7.0', '--yes'], {
        unhealthy: ['0.7.0'],
        migratesOn: '0.7.0',
        headLines: 9,
      })
      expect(srv.waitWorker()).toBe(1)
      expect(srv.running()).toBe('0.6.0')
      expect(srv.migrations()).toBe('15')
      expect(srv.env()).toMatch(/^AVERRA_VERSION=0\.6\.0$/m)
      expect(readFileSync(join(srv.dir, 'compose.yaml'), 'utf8')).toBe('# compose прежний\n')
      expect(srv.state('update-last.json')).toMatchObject({
        result: 'rolled-back',
        dbRestored: true,
      })
      // Отложенный бэкап записан в состояние
      expect(srv.state('backup-last.json').kind).toBe('pre-update')
    })

    it('процесс убит после запуска новой версии — повтор не говорит «уже версия», а откатывает', () => {
      const srv = server()
      const killed = srv.run(['update', '--version', '0.7.0', '--yes'], {
        migratesOn: '0.7.0',
        killOn: 'exec -T api node -e',
      })
      expect(killed.status, killed.output).toBe(3)
      expect(killed.stderr).toContain('процесс обновления оборвался')
      // Брошено на полпути: новая версия в .env, миграция применена, отметка хода осталась
      expect(srv.env()).toMatch(/^AVERRA_VERSION=0\.7\.0$/m)
      expect(srv.migrations()).toBe('16')
      expect(srv.state('update-last.json')).toMatchObject({
        result: 'in-progress',
        finishedAt: null,
        from: '0.6.0',
        to: '0.7.0',
      })
      expect(readFileSync(join(srv.dir, '.update-run'), 'utf8')).toMatch(/^PHASE=switch$/m)
      // API ещё не знает, что процесс мёртв: без API status.sh скажет, что обновление оборвалось
      writeFileSync(join(srv.fake, 'running'), 'stopped\n')
      const status = srv.run(['status', '--json'])
      expect(JSON.parse(status.stdout)).toMatchObject({
        apiDown: true,
        update: 'interrupted',
        updateLast: { result: 'in-progress' },
      })

      // Повтор: новая версия не готова — откат с восстановлением базы
      const again = srv.run(['update', '--version', '0.7.0', '--yes'], { unhealthy: ['0.7.0'] })
      expect(again.status, again.output).toBe(1)
      expect(again.stdout).not.toContain('Уже версия')
      expect(again.stdout).toContain(
        'Прошлое обновление 0.6.0 → 0.7.0 не завершилось (шаг «switch»)',
      )
      expect(srv.migrations()).toBe('15')
      expect(srv.running()).toBe('0.6.0')
      expect(srv.env()).toMatch(/^AVERRA_VERSION=0\.6\.0$/m)
      expect(srv.state('update-last.json')).toMatchObject({
        result: 'rolled-back',
        dbRestored: true,
        keptDatabase: expect.stringMatching(/^averra_rolled_back_/),
      })
      expect(srv.state('backup-last.json').kind).toBe('pre-update')
      expect(existsSync(join(srv.dir, '.update-run'))).toBe(false)
    })

    it('процесс убит после запуска новой версии, а она работает — повтор заканчивает обновление', () => {
      const srv = server()
      expect(
        srv.run(['update', '--version', '0.7.0', '--yes'], { killOn: 'exec -T api node -e' })
          .status,
      ).toBe(3)
      const again = srv.run(['update', '--version', '0.7.0', '--yes'])
      expect(again.status, again.output).toBe(0)
      expect(again.stdout).toContain(
        'Версия 0.7.0 работает и проходит проверку — заканчиваю обновление',
      )
      expect(srv.state('update-last.json')).toMatchObject({ result: 'updated', from: '0.6.0' })
      expect(readFileSync(join(srv.dir, 'averra.sh'), 'utf8')).toContain(
        'averra.sh ghcr.io/midhey/averra-api:0.7.0',
      )
      expect(existsSync(join(srv.dir, '.update-run'))).toBe(false)
    })

    it('процесс убит во время бэкапа (API остановлен) — повтор поднимает прежнюю версию и обновляет', () => {
      const srv = server()
      expect(srv.run(['update', '--version', '0.7.0', '--yes'], { killOn: 'pg_dump' }).status).toBe(
        3,
      )
      expect(srv.running()).toBe('stopped')
      const again = srv.run(['update', '--version', '0.7.0', '--yes'])
      expect(again.status, again.output).toBe(0)
      expect(again.stdout).toContain('Работает прежняя версия 0.6.0, ничего не менялось')
      expect(again.stdout).toContain('Готово: версия 0.7.0')
      expect(srv.running()).toBe('0.7.0')
      expect(srv.state('update-last.json')).toMatchObject({ result: 'updated' })
      // Брошенной временной папки бэкапа нет: её убрала ротация
      expect(srv.backups()).toEqual([expect.stringMatching(/-pre-update$/)])
    })

    it('процесс убит посреди отката между переименованиями баз — повтор возвращает рабочую базу и откатывает', () => {
      const srv = server()
      const killed = srv.run(['update', '--version', '0.7.0', '--yes'], {
        unhealthy: ['0.7.0'],
        migratesOn: '0.7.0',
        killOn: 'averra_restore RENAME TO averra',
      })
      expect(killed.status, killed.output).toBe(3)
      // Брошено между переименованиями: базы averra нет, рабочая (16 миграций) — под отложенным именем
      expect(existsSync(join(srv.fake, 'db-averra'))).toBe(false)
      const kept = (
        readdirSync(srv.fake).find((file) => file.startsWith('db-averra_rolled_back_')) ?? ''
      ).replace(/^db-/, '')
      expect(srv.migrations(kept)).toBe('16')
      expect(readFileSync(join(srv.dir, '.update-run'), 'utf8')).toMatch(/^PHASE=rollback$/m)

      const again = srv.run(['update', '--version', '0.7.0', '--yes'], { unhealthy: ['0.7.0'] })
      expect(again.status, again.output).toBe(1)
      expect(again.stdout).toContain(`возвращаю рабочую базу ${kept} на место`)
      // Откат дошёл: база из бэкапа, данные новой версии — в отложенной, удалять её не советуют
      expect(srv.migrations()).toBe('15')
      expect(srv.migrations(kept)).toBe('16')
      expect(again.output).not.toContain('dropdb')
      expect(srv.running()).toBe('0.6.0')
      expect(srv.state('update-last.json')).toMatchObject({
        result: 'rolled-back',
        dbRestored: true,
        keptDatabase: kept,
      })
    })

    it('процесс убит посреди отката после обоих переименований — повтор не восстанавливает второй раз и помнит отложенную базу', () => {
      const srv = server()
      expect(
        srv.run(['update', '--version', '0.7.0', '--yes'], {
          unhealthy: ['0.7.0'],
          migratesOn: '0.7.0',
          // Запуск прежней версии после восстановления базы
          killOn: ' up -d$',
        }).status,
      ).toBe(3)
      // Как если бы процесс убили сразу после переименований, до отметки RESTORED
      const mark = join(srv.dir, '.update-run')
      writeFileSync(mark, readFileSync(mark, 'utf8').replace(/^RESTORED=1\n/m, ''))
      const kept = (
        readdirSync(srv.fake).find((file) => file.startsWith('db-averra_rolled_back_')) ?? ''
      ).replace(/^db-/, '')
      expect(srv.migrations()).toBe('15')
      srv.clearCalls()
      const again = srv.run(['update', '--version', '0.7.0', '--yes'], { unhealthy: ['0.7.0'] })
      expect(again.status, again.output).toBe(1)
      expect(srv.calls().join('\n')).not.toContain('pg_restore')
      expect(srv.migrations(kept)).toBe('16')
      expect(srv.state('update-last.json')).toMatchObject({
        result: 'rolled-back',
        dbRestored: true,
        keptDatabase: kept,
      })
    })

    it('процесс убит на шаге switch до записи новой версии в .env — повтор откатывает, а не пишет «обновлено»', () => {
      const srv = server()
      expect(
        srv.run(['update', '--version', '0.7.0', '--yes'], { killOn: 'exec -T api node -e' })
          .status,
      ).toBe(3)
      // Как если бы процесс убили до записи .env: compose.yaml уже новый, а версия в .env — прежняя
      writeFileSync(
        join(srv.dir, '.env'),
        srv.env().replace(/^AVERRA_VERSION=0\.7\.0$/m, 'AVERRA_VERSION=0.6.0'),
      )
      const again = srv.run(['update', '--version', '0.7.0', '--yes'])
      expect(again.status, again.output).toBe(1)
      expect(again.stdout).not.toContain('заканчиваю обновление')
      expect(readFileSync(join(srv.dir, 'compose.yaml'), 'utf8')).toBe('# compose прежний\n')
      expect(readFileSync(join(srv.dir, 'averra.sh'), 'utf8')).toBe(readFileSync(script, 'utf8'))
      expect(srv.running()).toBe('0.6.0')
      expect(srv.state('update-last.json')).toMatchObject({ result: 'rolled-back' })
    })

    it('откат берёт compose.yaml.prev только этого обновления, а не оставшийся от прошлого', () => {
      const srv = server()
      expect(
        srv.run(['update', '--version', '0.7.0', '--yes'], { killOn: 'exec -T api node -e' })
          .status,
      ).toBe(3)
      // Отметка без копии этого обновления (PREV_SAVED) и compose.yaml.prev от позапрошлой версии
      const mark = join(srv.dir, '.update-run')
      writeFileSync(mark, readFileSync(mark, 'utf8').replace(/^PREV_SAVED=1\n/m, ''))
      writeFileSync(join(srv.dir, 'compose.yaml.prev'), '# compose позапрошлый\n')
      writeFileSync(join(srv.dir, 'compose.yaml'), '# compose прежний\n')
      writeFileSync(
        join(srv.dir, '.env'),
        srv.env().replace(/^AVERRA_VERSION=0\.7\.0$/m, 'AVERRA_VERSION=0.6.0'),
      )
      const again = srv.run(['update', '--version', '0.7.0', '--yes'])
      expect(again.status, again.output).toBe(1)
      expect(readFileSync(join(srv.dir, 'compose.yaml'), 'utf8')).toBe('# compose прежний\n')
    })
  })

  it('замок занят (идёт бэкап или восстановление) — отказ сразу, лог и итог прошлого обновления целы', () => {
    const srv = server()
    const log = join(srv.dir, 'update.log')
    writeFileSync(log, 'лог прошлого обновления\n')
    writeFileSync(join(srv.dir, '.update-exit'), '2\n')
    const busy = srv.run(['update', '--version', '0.7.0', '--yes'], { lockHeld: true })
    expect(busy.status).toBe(1)
    expect(busy.stderr).toContain('замок .averra.lock')
    expect(readFileSync(log, 'utf8')).toBe('лог прошлого обновления\n')
    expect(readFileSync(join(srv.dir, '.update-exit'), 'utf8')).toBe('2\n')
    expect(existsSync(join(srv.dir, '.update-run'))).toBe(false)
    expect(srv.env()).toMatch(/^AVERRA_VERSION=0\.6\.0$/m)

    // Замок свободен: лог дописывается (прошлый — выше черты), на экран — только этот запуск
    const run = srv.run(['update', '--version', '0.7.0', '--yes'])
    expect(run.status, run.output).toBe(0)
    const text = readFileSync(log, 'utf8')
    expect(text.startsWith('лог прошлого обновления\n')).toBe(true)
    expect(text).toMatch(/^==== \S+ update --version 0\.7\.0 ====$/m)
    expect(text).toContain('Готово: версия 0.7.0')
    expect(run.stdout).toContain('Готово: версия 0.7.0')
    expect(run.stdout).not.toContain('лог прошлого обновления')
  })

  it('процесс обновления, не взявший замок, не трогает номер и итог идущего', () => {
    const srv = server()
    writeFileSync(join(srv.dir, '.update-pid'), '424242\n')
    const run = srv.run(['update-worker', '--version', '0.7.0'], { lockHeld: true })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('замок')
    expect(readFileSync(join(srv.dir, '.update-pid'), 'utf8')).toBe('424242\n')
    expect(existsSync(join(srv.dir, '.update-exit'))).toBe(false)
  })

  it('кривая версия — отказ', () => {
    const run = server().run(['update', '--version', '0.7 ; rm -rf /'])
    expect(run.status).toBe(1)
    expect(run.output).toContain('нужна версия')
  })
})

describe('восстановление', () => {
  it('через новую базу и переименование; медиатека подменяется, пока API стоит; сайты пересобираются', () => {
    const srv = server()
    expect(srv.run(['backup']).status).toBe(0)
    const [name] = srv.backups()
    // После бэкапа база ушла вперёд (новые миграции и данные), в медиатеке новая картинка
    writeFileSync(join(srv.fake, 'db-averra'), '17\n')
    writeFileSync(join(srv.fake, 'data', 'media', 'site', 'after-backup.jpg'), 'новая')
    writeFileSync(join(srv.fake, 'data', 'sites', 'built.html'), 'собранный сайт')
    srv.clearCalls()
    const run = srv.run(['restore', name ?? '', '--yes'])
    expect(run.status, run.output).toBe(0)
    expect(srv.migrations()).toBe('15')
    const steps = srv.calls().map((line) => line.replace(/ -U averra/g, ''))
    const index = (needle: string) => steps.findIndex((line) => line.includes(needle))
    // Дамп встаёт в отдельную базу раньше, чем останавливается API
    expect(index('pg_restore -d averra_restore')).toBeLessThan(index('stop api'))
    expect(index('stop api')).toBeLessThan(index('RENAME TO averra_before_restore'))
    // Медиатека распаковывается во временную папку до изменений, а подменяет рабочую, пока API
    // остановлен: после переименования баз, до запуска. Сайты очищаются тоже без API
    const stage = index(
      'mkdir /data/media/.averra-restore && tar -C /data/media/.averra-restore -xzf -',
    )
    const swap = index('mkdir .averra-before-restore')
    const sites = index('find /data/sites')
    const up = index('up -d')
    expect(stage).toBeGreaterThanOrEqual(0)
    expect(stage).toBeLessThan(index('pg_restore -d averra_restore'))
    expect(swap).toBeGreaterThan(index('averra_restore RENAME TO averra'))
    expect(swap).toBeLessThan(sites)
    expect(sites).toBeLessThan(up)
    // Между остановкой и подменой API не запускался
    expect(steps.slice(index('stop api'), swap).some((line) => line.includes('up -d'))).toBe(false)
    // Медиатека — как в бэкапе, служебных папок не осталось; сайты собраны заново
    expect(srv.media()).toEqual(['site/original.jpg'])
    expect(existsSync(join(srv.fake, 'data', 'sites', 'built.html'))).toBe(false)
    expect(srv.builds().at(-1)).toBe('build 0.6.0: site/original.jpg ')
    // Восстановление на месте человек подтвердил: прежние база и медиатека удаляются после успеха
    expect(existsSync(join(srv.fake, 'db-averra_before_restore'))).toBe(false)
    expect(run.stdout).toContain('Опубликованные сайты собираются заново')
  })

  it('новый сервер с пустой медиатекой: API при старте собирает сайт уже с картинками из бэкапа', () => {
    const srv = server()
    expect(srv.run(['backup']).status).toBe(0)
    const [name] = srv.backups()
    // Новый сервер: медиатека пуста, сборок ещё не было
    rmSync(join(srv.fake, 'data', 'media', 'site'), { recursive: true })
    rmSync(join(srv.fake, 'builds.log'), { force: true })
    const run = srv.run(['restore', name ?? '', '--yes'])
    expect(run.status, run.output).toBe(0)
    // Каждый запуск API во время восстановления видел восстановленную медиатеку: сборка без
    // картинок («в медиатеке нет файла») не случается
    expect(srv.builds()).toEqual(['build 0.6.0: site/original.jpg '])
    expect(srv.media()).toEqual(['site/original.jpg'])
  })

  it('восстановление не трогает .env: сайт на домене выбирает API по восстановленной базе', () => {
    // SITE_ID в .env прежних версий: восстановление его больше не переписывает — Caddy берёт
    // сайт по ссылке main, которую API ставит при старте на сайт установки из базы
    const other = '11111111-1111-4111-8111-111111111111'
    const srv = server({ env: [`SITE_ID=${other}`] })
    expect(srv.run(['backup']).status).toBe(0)
    const [name] = srv.backups()
    const manifest = readFileSync(join(srv.dir, 'backups', name ?? '', 'manifest.json'), 'utf8')
    expect(manifest).not.toContain('siteId')
    const before = srv.env()
    const run = srv.run(['restore', name ?? '', '--yes'])
    expect(run.status, run.output).toBe(0)
    expect(srv.env()).toBe(before)
    expect(run.stdout).not.toContain('SITE_ID')
  })

  it('дамп не встал — рабочие база и медиатека не тронуты, API не останавливался', () => {
    const srv = server()
    expect(srv.run(['backup']).status).toBe(0)
    const [name] = srv.backups()
    writeFileSync(join(srv.fake, 'db-averra'), '17\n')
    writeFileSync(join(srv.fake, 'data', 'media', 'site', 'after-backup.jpg'), 'новая')
    srv.clearCalls()
    const run = srv.run(['restore', name ?? '', '--yes'], { restoreFailsInto: 'averra_restore' })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('рабочая база и медиатека не тронуты')
    expect(srv.migrations()).toBe('17')
    const text = srv.calls().join('\n')
    expect(text).not.toContain('stop api')
    // Распакованная медиатека убрана, рабочая не подменялась
    expect(srv.calls().some((line) => line.endsWith('-c rm -rf /data/media/.averra-restore'))).toBe(
      true,
    )
    expect(text).not.toContain('mkdir .averra-before-restore')
    expect(srv.media()).toEqual(['site/after-backup.jpg', 'site/original.jpg'])
  })

  it('API не поднялся на восстановленной базе — прежние база и медиатека на месте, неподнявшаяся база — с временем в имени', () => {
    const srv = server()
    expect(srv.run(['backup']).status).toBe(0)
    const [name] = srv.backups()
    writeFileSync(join(srv.fake, 'db-averra'), '17\n')
    // После бэкапа: одна картинка удалена, другая загружена
    rmSync(join(srv.fake, 'data', 'media', 'site', 'original.jpg'))
    writeFileSync(join(srv.fake, 'data', 'media', 'site', 'after-backup.jpg'), 'новая')
    srv.clearCalls()
    const run = srv.run(['restore', name ?? '', '--yes'], { unhealthy: ['0.6.0'] })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('прежние база и медиатека на месте')
    expect(srv.migrations()).toBe('17')
    const failed = readdirSync(srv.fake)
      .filter((file) => file.startsWith('db-averra_failed_restore_'))
      .map((file) => file.replace(/^db-/, ''))
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatch(/^averra_failed_restore_\d{8}_\d{6}$/)
    expect(srv.migrations(failed[0])).toBe('15')
    expect(run.stderr).toContain(`Неподнявшаяся база — ${failed[0]}`)
    expect(existsSync(join(srv.fake, 'db-averra_before_restore'))).toBe(false)
    // Медиатека — прежняя, служебных папок нет; прежний API собрал сайт из неё
    expect(srv.media()).toEqual(['site/after-backup.jpg'])
    expect(srv.builds().at(-1)).toBe('build 0.6.0: site/after-backup.jpg ')
    // Медиатека и сайты возвращаются, пока API остановлен
    const steps = srv.calls()
    const unswap = steps.findIndex((line) => line.includes('rm -rf "./$name"'))
    expect(unswap).toBeGreaterThan(steps.findLastIndex((line) => line.endsWith('stop api')))
    expect(unswap).toBeLessThan(steps.findLastIndex((line) => line.endsWith('up -d')))
  })

  it('медиатека не подменилась — прежние база и медиатека на месте, сообщение честное', () => {
    const srv = server()
    expect(srv.run(['backup']).status).toBe(0)
    const [name] = srv.backups()
    writeFileSync(join(srv.fake, 'db-averra'), '17\n')
    writeFileSync(join(srv.fake, 'data', 'media', 'site', 'after-backup.jpg'), 'новая')
    srv.clearCalls()
    // Подмена прошла до конца, но кончилась сбоем: прежнюю медиатеку надо вернуть из соседней папки
    const run = srv.run(['restore', name ?? '', '--yes'], {
      shFailsOn: 'mkdir .averra-before-restore',
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('медиатека не подменилась — прежние база и медиатека на месте')
    expect(run.output).not.toContain('Готово')
    expect(srv.migrations()).toBe('17')
    expect(srv.media()).toEqual(['site/after-backup.jpg', 'site/original.jpg'])
    expect(existsSync(join(srv.fake, 'db-averra_before_restore'))).toBe(false)
    expect(srv.running()).toBe('0.6.0')
    // API ни разу не запускался на восстановленной базе
    expect(srv.calls().filter((line) => line.endsWith('up -d'))).toHaveLength(1)
  })

  it('прежняя медиатека переехала не целиком — возвращается на место, ничего не удалено', () => {
    const srv = server()
    expect(srv.run(['backup']).status).toBe(0)
    const [name] = srv.backups()
    writeFileSync(join(srv.fake, 'db-averra'), '17\n')
    // После бэкапа — картинки ещё одного сайта; их папка в .averra-before-restore не переедет
    mkdirSync(join(srv.fake, 'data', 'media', 'other'))
    writeFileSync(join(srv.fake, 'data', 'media', 'other', 'after.jpg'), 'новая')
    writeFileSync(join(srv.fake, 'data', 'media', 'site', 'after-backup.jpg'), 'новая')
    const run = srv.run(['restore', name ?? '', '--yes'], { mvFailsOn: 'other' })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('медиатека не подменилась — прежние база и медиатека на месте')
    // Прежняя медиатека целиком, служебных папок нет
    expect(srv.media()).toEqual(['other/after.jpg', 'site/after-backup.jpg', 'site/original.jpg'])
    expect(srv.migrations()).toBe('17')
    expect(srv.running()).toBe('0.6.0')
  })

  it('прежняя медиатека не переехала и не вернулась — ничего не удалено, сообщение говорит где она', () => {
    const srv = server()
    expect(srv.run(['backup']).status).toBe(0)
    const [name] = srv.backups()
    mkdirSync(join(srv.fake, 'data', 'media', 'other'))
    writeFileSync(join(srv.fake, 'data', 'media', 'other', 'after.jpg'), 'новая')
    // Папка other не переезжает в .averra-before-restore, а уже переехавшая site не возвращается
    const run = srv.run(['restore', name ?? '', '--yes'], {
      mvFailsOn: 'other',
      mvBackFailsOn: 'site',
    })
    expect(run.status).toBe(1)
    expect(run.output).not.toContain('на месте —')
    expect(run.output).not.toContain('Готово')
    expect(run.stderr).toContain(
      'часть в папке /data/media/.averra-before-restore. Ничего не удалено',
    )
    // Ни одна прежняя картинка не удалена: одна на месте, другая в соседней папке
    expect(srv.media()).toEqual(['.averra-before-restore/site/original.jpg', 'other/after.jpg'])
    // API на этой половине медиатеки не запускался
    expect(srv.running()).toBe('stopped')
  })

  it('в томе осталась прежняя медиатека от прошлого восстановления — отказ до изменений, она не удаляется', () => {
    const srv = server()
    expect(srv.run(['backup']).status).toBe(0)
    const [name] = srv.backups()
    mkdirSync(join(srv.fake, 'data', 'media', '.averra-before-restore', 'site'), {
      recursive: true,
    })
    writeFileSync(join(srv.fake, 'data', 'media', '.averra-before-restore', 'site', 'old.jpg'), 'x')
    srv.clearCalls()
    const run = srv.run(['restore', name ?? '', '--yes'])
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('уже есть папка .averra-before-restore')
    expect(run.stderr).toContain('ничего не менялось')
    expect(srv.media()).toEqual(['.averra-before-restore/site/old.jpg', 'site/original.jpg'])
    expect(srv.calls().join('\n')).not.toMatch(/pg_restore|stop api|RENAME/)
  })

  it('восстановленная база не встала на место — прежняя возвращается, сообщение честное', () => {
    const srv = server()
    expect(srv.run(['backup']).status).toBe(0)
    const [name] = srv.backups()
    writeFileSync(join(srv.fake, 'db-averra'), '17\n')
    srv.clearCalls()
    const run = srv.run(['restore', name ?? '', '--yes'], { renameFailsFrom: ['averra_restore'] })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('рабочая база возвращена')
    expect(run.stderr).toContain('рабочая база и медиатека не тронуты')
    expect(srv.migrations()).toBe('17')
    expect(existsSync(join(srv.fake, 'db-averra_before_restore'))).toBe(false)
    expect(existsSync(join(srv.fake, 'db-averra_restore'))).toBe(false)
    // API снова запущен: перед переименованием его останавливали
    expect(srv.running()).toBe('0.6.0')

    // Вернуть не вышло — скрипт не говорит «не тронута», а говорит, где база и что делать
    const srv2 = server()
    expect(srv2.run(['backup']).status).toBe(0)
    const [name2] = srv2.backups()
    const broken = srv2.run(['restore', name2 ?? '', '--yes'], {
      renameFailsFrom: ['averra_restore', 'averra_before_restore'],
    })
    expect(broken.status).toBe(1)
    expect(broken.stdout).toContain(
      'Рабочей базы averra сейчас нет: прежняя лежит под именем averra_before_restore',
    )
    expect(broken.stderr).toContain('рабочая база не на своём месте')
    expect(broken.stderr).not.toContain('не тронут')
  })

  it('уже есть averra_before_restore от прошлого раза — отказ, ни одна база не удаляется', () => {
    const srv = server()
    expect(srv.run(['backup']).status).toBe(0)
    const [name] = srv.backups()
    writeFileSync(join(srv.fake, 'db-averra_before_restore'), '14\n')
    srv.clearCalls()
    const run = srv.run(['restore', name ?? '', '--yes'])
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('уже есть база averra_before_restore')
    expect(srv.migrations('averra_before_restore')).toBe('14')
    expect(srv.migrations()).toBe('15')
    expect(srv.calls().join('\n')).not.toMatch(/dropdb|stop api|RENAME/)
  })

  it('--from-s3: скачивает и расшифровывает копию, потом восстанавливает', () => {
    const s3 = [
      'BACKUP_S3_BUCKET=studio-backups',
      'BACKUP_S3_ACCESS_KEY_ID=YCAJE-ключ',
      'BACKUP_S3_SECRET_ACCESS_KEY=YCP-секрет-хранилища',
    ]
    const srv = server({ env: s3 })
    expect(srv.run(['backup']).status).toBe(0)
    const [name = ''] = srv.backups()
    // Сервер новый: локальной копии нет, есть только в хранилище
    mkdirSync(join(srv.fake, 'remote'), { recursive: true })
    renameSync(join(srv.dir, 'backups', name), join(srv.fake, 'remote', name))
    writeFileSync(join(srv.fake, 'db-averra'), '17\n')
    srv.clearCalls()
    const run = srv.run(['restore', '--from-s3', name, '--yes'])
    expect(run.status, run.output).toBe(0)
    expect(srv.backups()).toEqual([name])
    expect(srv.migrations()).toBe('15')
    const copy = srv.calls().find((line) => line.includes(` copy averra:${name} /restore`))
    expect(copy).toContain('-e RCLONE_CONFIG_AVERRA_TYPE=crypt')
    expect(srv.calls().join('\n')).not.toContain('YCP-секрет-хранилища')
    // Ничего временного не осталось
    expect(readdirSync(join(srv.dir, 'backups'))).toEqual([name])
  })

  it('--from-s3 без BACKUP_PASSPHRASE — отказ до скачивания', () => {
    const srv = server({
      env: [
        'BACKUP_S3_BUCKET=studio-backups',
        'BACKUP_S3_ACCESS_KEY_ID=YCAJE-ключ',
        'BACKUP_S3_SECRET_ACCESS_KEY=YCP-секрет-хранилища',
        'BACKUP_PASSPHRASE=',
      ],
    })
    const run = srv.run(['restore', '--from-s3', '20261016-033000-scheduled', '--yes'])
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('BACKUP_PASSPHRASE')
    expect(srv.calls().join('\n')).not.toContain(' copy ')
  })

  it('без терминала и --yes — отказ; повреждённый бэкап — отказ до изменений; чужое имя — отказ', () => {
    const srv = server()
    expect(srv.run(['backup']).status).toBe(0)
    const [name] = srv.backups()
    expect(srv.run(['restore', name ?? '']).stderr).toContain('добавьте --yes')
    writeFileSync(join(srv.dir, 'backups', name ?? '', 'db.dump'), 'испорчено')
    srv.clearCalls()
    const broken = srv.run(['restore', name ?? '', '--yes'])
    expect(broken.status).toBe(1)
    expect(broken.stderr).toContain('контрольные суммы не сошлись')
    expect(srv.calls()).toEqual([])
    expect(srv.run(['restore', '../../etc', '--yes']).stderr).toContain('не имя бэкапа')
  })

  it('verify проверяет бэкап ещё раз', () => {
    const srv = server()
    expect(srv.run(['backup']).status).toBe(0)
    const [name] = srv.backups()
    const run = srv.run(['verify', name ?? ''])
    expect(run.status, run.output).toBe(0)
    expect(run.stdout).toContain('в порядке')
  })
})

describe('состояние', () => {
  it('отдаёт ответ API, а без API — что известно без него', () => {
    const srv = server()
    const ok = srv.run(['status', '--json'])
    expect(ok.status).toBe(0)
    expect(ok.stdout.trim()).toBe('{"version":"from-api"}')
    expect(srv.calls().at(-1)).toBe('docker compose exec -T api node dist/server/status.js --json')

    expect(srv.run(['backup']).status).toBe(0)
    writeFileSync(join(srv.fake, 'running'), 'stopped\n')
    const down = srv.run(['status', '--json'])
    expect(down.status).toBe(1)
    const body = JSON.parse(down.stdout)
    expect(body).toMatchObject({ apiDown: true, configuredVersion: '0.6.0' })
    expect(body.backupLast).toMatchObject({ ok: true })
  })
})
