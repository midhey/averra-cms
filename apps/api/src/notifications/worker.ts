import type { NotificationChannelKind } from '@averra/schema'
import type { SecretBox } from '../crypto/secret-box'
import type { Db } from '../db/client'
import { retryDelayMs } from '../mail/outbox'
import { type ChannelRegistry, ChannelSendError, type ReadinessContext } from './channel'
import { isEventId, NotificationDataError, renderNotification } from './events'
import { type ClaimedNotification, notificationOutboxRepo } from './outbox'
import { channelConfigs } from './settings'

// Обработчик очереди уведомлений (notification_outbox) в процессе API — как обработчик писем
// (mail/worker.ts): забирает сообщения готовых каналов, отправляет по одному с арендой, сбой
// сообщения — повтор с растущей паузой, сбой канала — канал выжидает, попытки целы

export type NotificationProcessOptions = {
  db: Db
  channels: ChannelRegistry
  secretBox: SecretBox | undefined
  /** Почта процесса: без неё почтовый канал не готов (сам он через эту очередь не ходит) */
  readiness: () => ReadinessContext
  maxAttempts: number
  now?: () => Date
  batchSize?: number
  /** Каналы, которые сейчас выжидают после сбоя: их сообщения не берём */
  paused?: ReadonlySet<string>
  stopped?: () => boolean
  log?: (message: string) => void
}

export type NotificationProcessResult = {
  claimed: number
  sent: number
  retry: number
  failed: number
  skipped: number
  /** Каналы, которые сломались в этом проходе (сеть, токен): им пора выждать */
  down: Set<NotificationChannelKind>
  /** Каналы, которые в этом проходе что-то отправили: они снова работают */
  delivered: Set<NotificationChannelKind>
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : `Неизвестная ошибка: ${String(error)}`

/** Один проход: забрать сообщения готовых каналов и отправить по одному */
export async function processNotifications({
  db,
  channels,
  secretBox,
  readiness,
  maxAttempts,
  now = () => new Date(),
  batchSize = 10,
  paused = new Set(),
  stopped = () => false,
  log = () => {},
}: NotificationProcessOptions): Promise<NotificationProcessResult> {
  const repo = notificationOutboxRepo(db)
  const result: NotificationProcessResult = {
    claimed: 0,
    sent: 0,
    retry: 0,
    failed: 0,
    skipped: 0,
    down: new Set(),
    delivered: new Set(),
  }
  await repo.failStale({ now: now(), maxAttempts })
  // Настройки каналов — на проход: токен и прокси меняют в админке без перезапуска API
  const configs = await channelConfigs(db, channels, secretBox)
  const context = readiness()
  const ready = Object.values(channels).filter((channel) => {
    const config = configs.get(channel.kind)
    return (
      channel.send !== undefined &&
      !paused.has(channel.kind) &&
      config !== undefined &&
      channel.ready(config, context).ok
    )
  })
  const batch = await repo.claimDue({
    now: now(),
    limit: batchSize,
    maxAttempts,
    channels: ready.map((channel) => channel.kind),
  })
  result.claimed = batch.length

  async function release(item: ClaimedNotification, error?: string) {
    try {
      await repo.release(item, now(), error)
    } catch {
      // Не вышло — сообщение вернётся в очередь само, когда истечёт аренда
    }
  }

  for (const item of batch) {
    const kind = item.channel as NotificationChannelKind
    const channel = channels[kind]
    const config = configs.get(kind)
    if (stopped() || result.down.has(kind) || !channel?.send || !config) {
      await release(item)
      continue
    }
    if (!(await repo.renewLease(item, now()))) {
      result.skipped += 1
      continue
    }
    let messageId: string
    try {
      if (!isEventId(item.event)) {
        throw new ChannelSendError(`События «${item.event}» больше нет`, 'permanent')
      }
      const message = renderNotification(item.event, item.data)
      ;({ messageId } = await channel.send(config, item.address, message))
    } catch (error) {
      if (error instanceof ChannelSendError && error.kind === 'channel') {
        // Виноват канал, а не сообщение: попытку не тратим, остальные сообщения канала ждут
        result.down.add(kind)
        log(`Уведомление ${item.id} (${kind}) не отправлено: ${error.message}. Канал выжидает`)
        await release(item, error.message)
        continue
      }
      const permanent =
        error instanceof NotificationDataError ||
        (error instanceof ChannelSendError && error.kind === 'permanent')
      const outcome = await repo.markFailedAttempt(item, {
        now: now(),
        error: errorText(error),
        permanent,
        maxAttempts,
        retryAfterMs: error instanceof ChannelSendError ? error.retryAfterMs : undefined,
      })
      result[outcome] += 1
      log(
        `Уведомление ${item.id} (${kind}) не отправлено, попытка ${item.attempts}: ${errorText(error)}`,
      )
      continue
    }
    result.sent += 1
    result.delivered.add(kind)
    try {
      await repo.markSent(item, { now: now(), messageId })
    } catch (error) {
      // Ушло, а записать не вышло: остаётся в sending до конца аренды (потом может уйти ещё раз)
      log(`Уведомление ${item.id} отправлено, но записать это не вышло: ${errorText(error)}`)
      for (const rest of batch.slice(batch.indexOf(item) + 1)) await release(rest)
      break
    }
  }
  return result
}

/** Дольше этого канал после сбоя не выжидает */
const MAX_CHANNEL_PAUSE_MS = 30 * 60 * 1000

export type NotificationWorkerOptions = Omit<NotificationProcessOptions, 'paused' | 'stopped'> & {
  retentionDays: number
  intervalMs?: number
  cleanupEveryMs?: number
  /** Что ещё чистить по тому же расписанию: коды привязки чатов */
  cleanupAlso?: ReadonlyArray<{ what: string; run: (now: Date) => Promise<number> }>
}

/**
 * Обработчик в процессе API: раз в intervalMs отправляет, раз в cleanupEveryMs чистит старые
 * сообщения. Сломался канал — он выжидает с растущей паузой до MAX_CHANNEL_PAUSE_MS, остальные
 * каналы работают. wake() будит сразу и снимает паузы (поменяли настройки канала)
 */
export function startNotificationWorker({
  intervalMs = 5000,
  cleanupEveryMs = 60 * 60 * 1000,
  cleanupAlso = [],
  retentionDays,
  ...options
}: NotificationWorkerOptions) {
  const { db, now = () => new Date(), log = () => {} } = options
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined
  let again = false
  let lastCleanup = Number.NEGATIVE_INFINITY
  // Канал → сколько сбоев подряд и до какого времени выжидает
  const pauses = new Map<string, { failures: number; until: number }>()

  async function tick() {
    try {
      const time = now().getTime()
      if (time - lastCleanup >= cleanupEveryMs) {
        lastCleanup = time
        const removed = await notificationOutboxRepo(db).cleanup({ now: now(), retentionDays })
        if (removed > 0) log(`Из очереди уведомлений удалено старых: ${removed}`)
        for (const { what, run } of cleanupAlso) {
          const count = await run(now())
          if (count > 0) log(`Удалено старых записей (${what}): ${count}`)
        }
      }
      const batchSize = options.batchSize ?? 10
      while (!stopped) {
        const current = now().getTime()
        const paused = new Set(
          [...pauses].filter(([, pause]) => pause.until > current).map(([kind]) => kind),
        )
        const result = await processNotifications({
          ...options,
          paused,
          stopped: () => stopped,
        })
        for (const kind of result.down) {
          const failures = (pauses.get(kind)?.failures ?? 0) + 1
          const pause = Math.min(Math.max(intervalMs, retryDelayMs(failures)), MAX_CHANNEL_PAUSE_MS)
          pauses.set(kind, { failures, until: now().getTime() + pause })
          log(
            `Канал уведомлений ${kind} не отвечает: следующая попытка через ${Math.round(pause / 1000)} с`,
          )
        }
        // Пауза снимается только с канала, который сам отправил: выжидающий в проход не попал,
        // и чужая удача ничего не говорит о нём
        for (const kind of result.delivered) {
          if (!result.down.has(kind)) pauses.delete(kind)
        }
        if (result.down.size > 0 || result.claimed < batchSize) break
      }
    } catch (error) {
      log(`Обработчик уведомлений: ${errorText(error)}`)
    }
    // Выжидающий канал просто не берётся в проход: следующий круг — как обычно
    return intervalMs
  }

  function run() {
    if (stopped) return
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (running) {
      again = true
      return
    }
    running = tick().then((pause) => {
      running = undefined
      if (stopped) return
      const delay = again ? 0 : pause
      again = false
      timer = setTimeout(run, delay)
    })
  }

  run()

  return {
    /**
     * Посмотреть в очередь сейчас. resetPauses: true — настройки каналов поменяли, паузы не
     * в счёт; вид канала — он прошёл «Проверить», снимается только его пауза
     */
    wake(resetPauses: boolean | NotificationChannelKind = false) {
      if (resetPauses === true) pauses.clear()
      else if (resetPauses) pauses.delete(resetPauses)
      run()
    },
    busy: () => running !== undefined,
    async stop() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      await running
    },
  }
}

export type NotificationWorker = ReturnType<typeof startNotificationWorker>
