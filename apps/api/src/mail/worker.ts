import type { Db } from '../db/client'
import { type Mailer, MailSendError, type MailStep } from './mailer'
import { type ClaimedMail, outboxRepo, retryDelayMs } from './outbox'
import { MailDataError, MailTemplateId, renderMail } from './templates'

export type OutboxSettings = {
  /** Сколько раз пробовать отправить письмо */
  maxAttempts: number
  /** Через сколько дней удалять отправленные и неотправленные письма */
  retentionDays: number
}

export type ProcessOptions = OutboxSettings & {
  db: Db
  mailer: Mailer
  now?: () => Date
  /** Сколько писем брать за раз */
  batchSize?: number
  /** Остановлен ли обработчик: тогда письма пачки, до которых не дошло, ждут следующего запуска */
  stopped?: () => boolean
  log?: (message: string) => void
}

/** Текст ошибки для очереди: MailSendError уже без секретов, остальное — как есть, коротко */
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : `Неизвестная ошибка: ${String(error)}`

/**
 * Шаги, на которых ломается сервер, а не письмо: DNS, соединение, TLS, вход. Такая ошибка
 * повторится на любом письме, поэтому проход прерывается, а не тратит попытки всей пачки
 * и не логинится на сервер десять раз подряд (провайдеры за такое блокируют ящик)
 */
const SERVER_STEPS: ReadonlySet<MailStep> = new Set(['dns', 'connection', 'tls', 'auth'])

const isServerFailure = (error: unknown) =>
  error instanceof MailSendError &&
  !error.permanent &&
  error.step !== undefined &&
  SERVER_STEPS.has(error.step)

export const LINK_EXPIRED_ERROR =
  'Ссылка в письме истекла, пока письмо ждало отправки: письмо не отправлено'

export type ProcessResult = {
  claimed: number
  sent: number
  retry: number
  failed: number
  /** Письма пачки, которые за время прохода взял другой обработчик: их отправит он */
  skipped: number
  /** Сломался сервер (DNS, соединение, TLS, вход): остальные письма отпущены, обработчику пора выждать */
  serverDown: boolean
  /** Проход прерван сбоем базы: письмо ушло, а записать это не вышло */
  aborted: boolean
}

/**
 * Один проход обработчика: забрать письма, которым пора, и отправить по одному. Перед каждым
 * письмом аренда продлевается: если его уже взял другой обработчик, письмо пропускается.
 * Сбой письма — следующая попытка с растущей паузой, после maxAttempts или при постоянном
 * отказе — failed. Сбой сервера — остальные письма пачки отпускаются без траты попыток
 */
export async function processOutbox({
  db,
  mailer,
  maxAttempts,
  now = () => new Date(),
  batchSize = 10,
  stopped = () => false,
  log = () => {},
}: ProcessOptions): Promise<ProcessResult> {
  const repo = outboxRepo(db)
  const result: ProcessResult = {
    claimed: 0,
    sent: 0,
    retry: 0,
    failed: 0,
    skipped: 0,
    serverDown: false,
    aborted: false,
  }
  await repo.failStale({ now: now(), maxAttempts })
  await repo.expireLinks(now())
  const batch = await repo.claimDue({ now: now(), limit: batchSize, maxAttempts })
  result.claimed = batch.length

  /** Отпустить письма, до которых проход не дойдёт. Без исключений: база может быть недоступна */
  async function releaseRest(rest: ClaimedMail[]) {
    for (const mail of rest) {
      try {
        await repo.release(mail, now())
      } catch {
        // Не вышло — письмо вернётся в очередь само, когда истечёт аренда
      }
    }
  }

  for (const [index, mail] of batch.entries()) {
    if (stopped()) {
      // Остановка: письма пачки, до которых не дошло, отпускаем сразу, а не через пять минут аренды
      await releaseRest(batch.slice(index))
      break
    }
    // Срок ссылки мог выйти, пока шли письма перед этим
    if (mail.expiresAt !== null && mail.expiresAt <= now()) {
      const outcome = await repo.markFailedAttempt(mail, {
        now: now(),
        error: LINK_EXPIRED_ERROR,
        permanent: true,
        maxAttempts,
      })
      result[outcome] += 1
      continue
    }
    // Аренда — на одно письмо: пачка могла идти дольше аренды, и письмо уже у другого обработчика
    if (!(await repo.renewLease(mail, now()))) {
      result.skipped += 1
      log(`Письмо ${mail.id} (${mail.template}) уже взял другой обработчик: пропускаем`)
      continue
    }

    let messageId: string
    try {
      // Данные из базы снова идут в работу — проверяем их нынешней схемой шаблона:
      // письмо в очереди могло лечь до того, как схема поменялась
      const template = MailTemplateId.safeParse(mail.template)
      if (!template.success) {
        throw new MailSendError(`Шаблона «${mail.template}» больше нет`, true)
      }
      const rendered = renderMail(template.data, mail.data)
      ;({ messageId } = await mailer.send({ to: mail.recipient, ...rendered }))
    } catch (error) {
      const permanent =
        error instanceof MailDataError || (error instanceof MailSendError && error.permanent)
      const outcome = await repo.markFailedAttempt(mail, {
        now: now(),
        error: errorText(error),
        permanent,
        maxAttempts,
      })
      result[outcome] += 1
      log(
        `Письмо ${mail.id} (${mail.template}) не отправлено, попытка ${mail.attempts}: ${errorText(error)}`,
      )
      if (isServerFailure(error)) {
        result.serverDown = true
        await releaseRest(batch.slice(index + 1))
        break
      }
      continue
    }

    // Письмо ушло. Сбой записи — не неудачная попытка: иначе письмо вернулось бы в очередь
    // и ушло ещё раз. Оно остаётся в sending до конца аренды, а проход прерывается: база,
    // скорее всего, недоступна
    result.sent += 1
    try {
      await repo.markSent(mail, { now: now(), messageId })
    } catch (error) {
      result.aborted = true
      log(
        `Письмо ${mail.id} (${mail.template}) отправлено, но записать это в базу не вышло: ${errorText(error)}. ` +
          'Оно останется в статусе «отправляется» до конца аренды и потом может уйти повторно',
      )
      await releaseRest(batch.slice(index + 1))
      break
    }
  }
  return result
}

export type MailWorkerOptions = Omit<ProcessOptions, 'stopped' | 'mailer'> & {
  /** Провайдер. Без него (почта выключена) обработчик писем не шлёт, а только чистит очередь */
  mailer?: Mailer
  /** Как часто смотреть в очередь, мс */
  intervalMs?: number
  /** Как часто чистить старые письма, мс */
  cleanupEveryMs?: number
  /**
   * Что ещё чистить вместе с очередью и по тому же сроку retentionDays: например, закрытые
   * приглашения (index.ts). run удаляет записи, закрытые раньше before, и говорит, сколько
   */
  cleanupAlso?: ReadonlyArray<{ what: string; run: (before: Date) => Promise<number> }>
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Дольше этого обработчик не ждёт, когда почтовый сервер недоступен: чинят его обычно быстрее */
export const MAX_SERVER_PAUSE_MS = 30 * 60 * 1000

/**
 * Обработчик очереди в процессе API: раз в intervalMs забирает письма и отправляет их, раз
 * в cleanupEveryMs чистит старые и гасит письма с истёкшими ссылками. Сломался сервер (вход,
 * TLS, соединение) — выжидает с растущей паузой до MAX_SERVER_PAUSE_MS. wake() будит его сразу.
 * stop() больше не берёт писем, ждёт отправку, которая уже идёт, и только потом отпускает —
 * index.ts зовёт его до закрытия базы. Без mailer только чистит: письма с персональными
 * данными не лежат дольше срока, даже когда почта выключена
 */
export function startMailWorker({
  intervalMs = 5000,
  cleanupEveryMs = 60 * 60 * 1000,
  cleanupAlso = [],
  mailer,
  ...options
}: MailWorkerOptions) {
  const { db, retentionDays, now = () => new Date(), log = () => {} } = options
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined
  let again = false
  let lastCleanup = Number.NEGATIVE_INFINITY
  // Сколько проходов подряд сломался сервер: от этого растёт пауза
  let serverFailures = 0

  /** Один круг. Возвращает паузу до следующего */
  async function tick() {
    try {
      const time = now().getTime()
      if (time - lastCleanup >= cleanupEveryMs) {
        lastCleanup = time
        const repo = outboxRepo(db)
        await repo.expireLinks(now())
        const removed = await repo.cleanup({ now: now(), retentionDays })
        if (removed > 0) log(`Из очереди писем удалено старых: ${removed}`)
        const before = new Date(now().getTime() - retentionDays * DAY_MS)
        for (const { what, run } of cleanupAlso) {
          const count = await run(before)
          if (count > 0) log(`Удалено старых записей (${what}): ${count}`)
        }
      }
      if (!mailer) return intervalMs
      // Полная пачка — в очереди, скорее всего, есть ещё: берём сразу следующую
      const batchSize = options.batchSize ?? 10
      while (!stopped) {
        const result = await processOutbox({ ...options, mailer, stopped: () => stopped })
        if (result.serverDown) {
          serverFailures += 1
          const pause = Math.min(
            Math.max(intervalMs, retryDelayMs(serverFailures)),
            MAX_SERVER_PAUSE_MS,
          )
          log(
            `Почтовый сервер не отвечает как надо, остальные письма ждут: следующая попытка через ${Math.round(pause / 1000)} с`,
          )
          return pause
        }
        if (result.sent > 0) serverFailures = 0
        if (result.aborted || result.claimed < batchSize) break
      }
    } catch (error) {
      // Сбой базы не должен ронять API: обработчик попробует снова на следующем круге
      log(`Обработчик писем: ${errorText(error)}`)
    }
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
    /** Посмотреть в очередь сейчас, не дожидаясь следующего круга (и паузы после сбоя сервера) */
    wake: run,
    /** Идёт ли круг прямо сейчас: stop() будет его ждать */
    busy: () => running !== undefined,
    async stop() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      await running
    },
  }
}

export type MailWorker = ReturnType<typeof startMailWorker>
