import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BuildFailure } from './queue'

/**
 * Папка рендерера по умолчанию: apps/renderer рядом с apps/api. Путь считается от этого файла,
 * и глубина у него та же, что у собранного API (src/publish/ и dist/server/), поэтому верен
 * и в репозитории, и в образе. В образе его всё равно задаёт RENDERER_DIR
 */
export const defaultRendererDir = () => fileURLToPath(new URL('../../../renderer', import.meta.url))

/** Скрипт сборки релиза в пакете рендерера */
export const RENDER_SCRIPT = join('scripts', 'build-release.mjs')

/** Сколько вывода сборщика держать в памяти: на причину сбоя хватает хвоста */
const OUTPUT_TAIL = 64 * 1024

/**
 * Переменные окружения, которые сборщик получает от API. Только нужное для запуска Node и путей:
 * секреты API (AUTH_SECRET, DATABASE_URL, MAIL_ENCRYPTION_KEY, SMTP_PASSWORD) сборщику не нужны
 * и в его вывод (а через него в журнал сборок и админку) попасть не должны
 */
const PASSED_ENV = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'LANG']

export type RenderOptions = {
  rendererDir: string
  /** Адрес API, откуда сборщик берёт снимок сайта: этот же процесс на loopback */
  apiUrl: string
  /** Кеш сборщика (Vite, Astro): вне папки рендерера, которая в образе только для чтения */
  cacheDir: string
  timeoutMs: number
  /** --max-old-space-size процесса сборки, МБ */
  maxMemoryMb: number
  /** Node, которой запускать сборку. По умолчанию — та же, что у API */
  nodePath?: string
}

export type Render = (input: {
  siteId: string
  outDir: string
  /** Остановка API: процесс сборщика убивается сразу */
  signal?: AbortSignal
}) => Promise<{ peakRssBytes?: number }>

/** Убирает цвета терминала из вывода: в админке они были бы мусором */
const ANSI_COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const plain = (text: string) => text.replace(ANSI_COLOR, '')

/** Последняя строка вывода, если это JSON с пиковой памятью (её печатает build-release.mjs) */
function peakFrom(stdout: string) {
  const last = stdout.trim().split('\n').at(-1)
  try {
    const parsed = JSON.parse(last ?? '') as { peakRssBytes?: unknown }
    return typeof parsed.peakRssBytes === 'number' ? parsed.peakRssBytes : undefined
  } catch {
    return undefined
  }
}

/**
 * Сборка сайта отдельным процессом Node: scripts/build-release.mjs рендерера. Отдельный процесс —
 * чтобы память сборки освобождалась целиком, зависшая сборка убивалась по времени, а сбой
 * сборщика не ронял API. Ненулевой код, сигнал или таймаут — BuildFailure с хвостом вывода
 */
export function rendererProcess(options: RenderOptions): Render {
  return ({ siteId, outDir, signal }) =>
    new Promise((resolve, reject) => {
      const env: Record<string, string> = {}
      for (const key of PASSED_ENV) {
        const value = process.env[key]
        if (value !== undefined) env[key] = value
      }
      Object.assign(env, {
        NODE_ENV: 'production',
        ASTRO_TELEMETRY_DISABLED: '1',
        CMS_SITE_ID: siteId,
        CMS_API_URL: options.apiUrl,
        CMS_LINKS: 'relative',
        AVERRA_OUT_DIR: outDir,
        AVERRA_CACHE_DIR: options.cacheDir,
      })
      const child = spawn(
        options.nodePath ?? process.execPath,
        [`--max-old-space-size=${options.maxMemoryMb}`, RENDER_SCRIPT],
        {
          cwd: options.rendererDir,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          ...(signal ? { signal, killSignal: 'SIGKILL' as const } : {}),
        },
      )
      let stdout = ''
      let output = ''
      const keep = (chunk: Buffer, toStdout: boolean) => {
        const text = chunk.toString('utf8')
        if (toStdout) stdout = (stdout + text).slice(-OUTPUT_TAIL)
        output = (output + text).slice(-OUTPUT_TAIL)
      }
      child.stdout.on('data', (chunk: Buffer) => keep(chunk, true))
      child.stderr.on('data', (chunk: Buffer) => keep(chunk, false))
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, options.timeoutMs)
      let failedToStart: Error | undefined
      child.on('error', (error) => {
        // Прерывание по signal тоже приходит сюда (AbortError), а потом ещё и close
        if (error.name !== 'AbortError') failedToStart = error
      })
      child.on('close', (code, exitSignal) => {
        clearTimeout(timer)
        const peak = peakFrom(stdout)
        if (failedToStart) {
          reject(new BuildFailure(`Не удалось запустить сборку: ${failedToStart.message}`))
        } else if (signal?.aborted) {
          reject(new BuildFailure('Сборка прервана остановкой API', peak))
        } else if (timedOut) {
          reject(
            new BuildFailure(
              `Сборка не уложилась в ${Math.round(options.timeoutMs / 1000)} с и остановлена`,
              peak,
            ),
          )
        } else if (code === 0) {
          resolve({ peakRssBytes: peak })
        } else {
          // SIGKILL без нашего таймаута — обычно ядро: процессу не хватило памяти (OOM)
          const reason =
            exitSignal === 'SIGKILL'
              ? 'процесс убит системой — скорее всего, не хватило памяти'
              : exitSignal
                ? `остановлена сигналом ${exitSignal}`
                : `код выхода ${code}`
          reject(new BuildFailure(`Сборка упала (${reason}):\n${plain(output).trim()}`, peak))
        }
      })
    })
}
