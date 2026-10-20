import type { Db } from '../db/client'
import { errorForLog } from '../log-error'
import { buildsRepo } from '../modules/builds/repo'

// Очередь сборок сайтов на сервере. Без Node API: её тип видят маршруты, а сама
// сборка (процесс Astro, папки релизов) приходит снаружи функцией build из index.ts

/** Итог удачной сборки: какая папка релиза стала текущей и сколько памяти заняла сборка */
export type BuildResult = { release: string; peakRssBytes?: number }

/**
 * Собирает опубликованный сайт и делает новую версию текущей. Ошибка — сайт не тронут.
 * signal — остановка API: сборку прервать (процесс сборщика убить), не дожидаясь конца
 */
export type SiteBuild = (siteId: string, signal: AbortSignal) => Promise<BuildResult>

/** Сборка упала: причина для журнала и, если успели узнать, пиковая память процесса */
export class BuildFailure extends Error {
  override name = 'BuildFailure'
  constructor(
    message: string,
    readonly peakRssBytes?: number,
  ) {
    super(message)
  }
}

/** Что видят маршруты: попросить пересобрать сайт. Ответа не ждут — сборка идёт в очереди */
export type SitePublisher = {
  request(siteId: string): Promise<void>
}

export type PublishQueueDeps = {
  db: Db
  build: SiteBuild
  log: (message: string) => void
  now?: () => Date
}

/**
 * Сборки идут по одной на всю установку: сборка Astro — самое тяжёлое на VPS с 1–2 ГБ, две сразу
 * удвоили бы пик памяти. Тем более не идут параллельно две сборки одного сайта. Публикация, пока
 * сайт собирается, заводит ещё одну сборку после текущей (опубликованное читается в начале
 * сборки, и новая правка в текущую могла не попасть); публикация, пока сборка ждёт, новой не
 * заводит. Очередь живёт в процессе API: API на установке один, а журнал сборок — в базе
 * (buildsRepo), он переживает перезапуск (recover)
 */
export function createPublishQueue({ db, build, log, now = () => new Date() }: PublishQueueDeps) {
  const repo = buildsRepo(db)
  // Сайты, которые ждут сборки, по порядку и без повторов
  const waiting: string[] = []
  // Сборки, которые идут в этом процессе: markInterrupted не должен счесть их прерванными
  // перезапуском. Вторая защита к порядку в index.ts (пометка до serve())
  const running = new Set<string>()
  let loop: Promise<void> | undefined
  let stopped = false
  // Остановка API прерывает идущую сборку: ждать её до PUBLISH_TIMEOUT_SECONDS при docker stop
  // (10 секунд до SIGKILL) нельзя. Прерванная остаётся в журнале «идёт» и при следующем старте
  // помечается прерванной и собирается заново (recover)
  const aborter = new AbortController()

  function kick() {
    if (loop || stopped || waiting.length === 0) return
    loop = drain().finally(() => {
      loop = undefined
      // Сайт мог встать в очередь, пока цикл заканчивался
      kick()
    })
  }

  async function drain() {
    for (let siteId = waiting.shift(); siteId && !stopped; siteId = waiting.shift()) {
      try {
        await runOne(siteId)
      } catch (error) {
        // Сбой базы при записи журнала: сборку не повторяем молча, но очередь не останавливаем
        log(`Сборка сайта ${siteId}: не удалось записать журнал — ${String(errorForLog(error))}`)
      }
    }
  }

  async function runOne(siteId: string) {
    const id = await repo.start(siteId, now())
    // Ждущей сборки нет: её взял прежний проход (сайт встал в очередь второй раз, пока
    // сборка ещё не началась) или сайт удалили
    if (!id) return
    running.add(id)
    try {
      await buildAndRecord(siteId, id)
    } finally {
      running.delete(id)
    }
    await repo.prune(siteId)
  }

  async function buildAndRecord(siteId: string, id: string) {
    const started = Date.now()
    try {
      const result = await build(siteId, aborter.signal)
      await repo.succeed(id, result, now())
      log(
        `Сайт ${siteId} собран за ${Math.round((Date.now() - started) / 1000)} с: релиз ${result.release}` +
          (result.peakRssBytes
            ? `, пик памяти ${Math.round(result.peakRssBytes / 2 ** 20)} МБ`
            : ''),
      )
    } catch (error) {
      if (stopped) {
        log(`Сборка сайта ${siteId} прервана остановкой API: соберётся заново при старте`)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      const peak = error instanceof BuildFailure ? error.peakRssBytes : undefined
      await repo.fail(id, message, peak, now())
      log(`Сборка сайта ${siteId} упала, на сайте прежняя версия: ${message.slice(0, 500)}`)
    }
  }

  async function request(siteId: string) {
    if (stopped) return
    await repo.request(siteId, now())
    if (!waiting.includes(siteId)) waiting.push(siteId)
    kick()
  }

  /**
   * Старт API, шаг 1 — до того, как сервер начнёт принимать запросы: сборки, прерванные прошлым
   * перезапуском, помечаются упавшими. Возвращает их сайты и сайты с ждущими сборками — их
   * соберёт resume. До serve(): публикация не успеет начать сборку, которую сочли бы прерванной.
   * Сборки, уже идущие в этом процессе, не трогаются, даже если вызвать его позже
   */
  function markInterrupted() {
    return repo.recover(now(), [...running])
  }

  /**
   * Старт API, шаг 2 — когда сервер слушает порт (сборщик ходит в этот API): сайты из
   * markInterrupted и сайты из ensure (опубликованные, у которых на диске нет текущей версии:
   * свежая установка, потерянная папка) встают в очередь
   */
  async function resume(sites: readonly string[], ensure: readonly string[] = []) {
    for (const siteId of [...sites, ...ensure.filter((id) => !sites.includes(id))]) {
      await request(siteId)
    }
  }

  return {
    request,

    /** Дождаться, пока очередь опустеет (тесты; остановка API — через stop) */
    async idle() {
      while (loop) await loop
    },

    /**
     * Остановка API: новых сборок не брать, идущую прервать и дождаться, пока она уберёт за собой.
     * Ждущие и прерванная остаются в журнале до следующего старта (recover)
     */
    async stop() {
      stopped = true
      aborter.abort()
      while (loop) await loop
    },

    markInterrupted,
    resume,

    /** Оба шага старта подряд (тесты; в index.ts между ними — serve()) */
    async recover(ensure: readonly string[] = []) {
      const sites = await markInterrupted()
      await resume(sites, ensure)
      return sites
    },
  }
}

export type PublishQueue = ReturnType<typeof createPublishQueue>
