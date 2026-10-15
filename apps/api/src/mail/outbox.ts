import { MailAddress } from '@averra/schema'
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { mailOutbox } from '../db/schema'
import {
  MailDataError,
  type MailTemplateData,
  type MailTemplateId,
  mailExpiresAt,
  parseMailData,
  renderMail,
  templatesKeepingData,
} from './templates'

// Очередь писем (паттерн outbox): письмо пишется в базу вместе с действием, а уходит потом,
// с повторами. Упал SMTP — действие не откатывается и письмо не теряется.
// Время везде параметром, а не now() базы: так тесты двигают часы, а не ждут минутами.
// Данные письма живут в очереди только до отправки: отправленное письмо их теряет сразу,
// а письмо с одноразовой ссылкой (secret у шаблона) — ещё и после неудачи или срока ссылки

/** Транзакция Drizzle: письмо ставится в очередь тем же объектом, что и действие */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbOrTx = Db | Tx

/**
 * Аренда одного письма: столько обработчик держит его, прежде чем письмо сможет взять другой.
 * Выдаётся при заборе и продлевается перед отправкой каждого письма пачки (renewLease), так что
 * её хватает на одну отправку, а не на всю пачку. Больше любого тайм-аута SMTP
 */
export const SENDING_LEASE_MS = 5 * 60 * 1000

const MINUTE = 60 * 1000
const MAX_RETRY_DELAY_MS = 6 * 60 * MINUTE

/**
 * Пауза перед следующей попыткой: 1, 3, 9, 27… минут, не больше 6 часов. С 8 попытками
 * по умолчанию письмо пробует уйти около 12 часов — за это время чинят почти любой сбой SMTP
 */
export const retryDelayMs = (attempt: number) =>
  Math.min(MINUTE * 3 ** Math.max(attempt - 1, 0), MAX_RETRY_DELAY_MS)

export type NewMail<T extends MailTemplateId> = {
  template: T
  data: MailTemplateData<T>
  to: string
  /** Сайт, к которому относится письмо (заявка). У писем системы — нет */
  siteId?: string
}

/**
 * Ставит письмо в очередь. db — тот же объект базы или транзакции, что и у действия:
 * откатится действие — откатится и письмо. Данные проверяются схемой шаблона, а письмо
 * собирается сразу, чтобы кривые данные (например, слишком длинная тема) отклонились здесь,
 * в запросе, а не через час в обработчике. Ошибка — MailDataError
 */
export async function enqueueMail<T extends MailTemplateId>(
  db: DbOrTx,
  mail: NewMail<T>,
  now = new Date(),
) {
  const to = MailAddress.safeParse(mail.to)
  if (!to.success) {
    throw new MailDataError(
      mail.template,
      to.error.issues.map((issue) => ({ ...issue, path: ['to', ...issue.path] })),
    )
  }
  const data = parseMailData(mail.template, mail.data)
  renderMail(mail.template, data)
  const [row] = await db
    .insert(mailOutbox)
    .values({
      template: mail.template,
      data,
      recipient: to.data,
      siteId: mail.siteId,
      nextAttemptAt: now,
      expiresAt: mailExpiresAt(mail.template, data, now),
      createdAt: now,
    })
    .returning({ id: mailOutbox.id })
  if (!row) throw new Error('База не вернула письмо, поставленное в очередь')
  return row
}

/** Письмо, которое обработчик взял в отправку */
export type ClaimedMail = {
  id: string
  claimId: string
  template: string
  data: unknown
  recipient: string
  attempts: number
  /** Срок одноразовой ссылки в письме: позже письмо не отправляется */
  expiresAt: Date | null
}

/** Остаются ли данные у неотправленного письма: только у шаблонов без секретов */
const keepsDataOnFailure = (template: string) =>
  (templatesKeepingData as string[]).includes(template)

/**
 * Данные письма, которое окончательно не ушло: у шаблонов без секретов остаются (письмо можно
 * повторить вручную), у остальных стираются. Для массовых UPDATE, где шаблон у каждой строки свой
 */
const dataAfterFailure = sql`CASE WHEN ${inArray(mailOutbox.template, templatesKeepingData)} THEN ${mailOutbox.data} ELSE NULL END`

export function outboxRepo(db: Db) {
  /** Только письмо, которое взял именно этот обработчик: чужую аренду не переписываем */
  const claimed = (mail: Pick<ClaimedMail, 'id' | 'claimId'>) =>
    and(eq(mailOutbox.id, mail.id), eq(mailOutbox.claimId, mail.claimId))

  return {
    /**
     * Забирает до limit писем, которым пора уходить, одним запросом: выборка под
     * FOR UPDATE SKIP LOCKED и смена статуса на sending. Два обработчика (два процесса API
     * на одной базе) одно письмо одновременно не возьмут. Письмо в sending с истёкшей
     * арендой — обработчик упал посреди отправки или застрял — берётся снова
     */
    async claimDue({ now, limit, maxAttempts }: { now: Date; limit: number; maxAttempts: number }) {
      const claimId = crypto.randomUUID()
      const due = db
        .select({ id: mailOutbox.id })
        .from(mailOutbox)
        .where(
          or(
            and(eq(mailOutbox.status, 'pending'), lte(mailOutbox.nextAttemptAt, now)),
            and(
              eq(mailOutbox.status, 'sending'),
              lte(mailOutbox.lockedUntil, now),
              lt(mailOutbox.attempts, maxAttempts),
            ),
          ),
        )
        .orderBy(mailOutbox.nextAttemptAt, mailOutbox.createdAt)
        .limit(limit)
        .for('update', { skipLocked: true })
      const rows = await db
        .update(mailOutbox)
        // lastAttemptAt здесь не ставим: взятое письмо могут отпустить, не отправляя (сбой
        // сервера на другом письме, остановка). Время попытки пишет renewLease перед отправкой
        .set({
          status: 'sending',
          claimId,
          lockedUntil: new Date(now.getTime() + SENDING_LEASE_MS),
          attempts: sql`${mailOutbox.attempts} + 1`,
        })
        .where(inArray(mailOutbox.id, due))
        .returning({
          id: mailOutbox.id,
          template: mailOutbox.template,
          data: mailOutbox.data,
          recipient: mailOutbox.recipient,
          attempts: mailOutbox.attempts,
          expiresAt: mailOutbox.expiresAt,
          nextAttemptAt: mailOutbox.nextAttemptAt,
          createdAt: mailOutbox.createdAt,
        })
      // RETURNING не обещает порядок выборки: письма уходят в порядке очереди, сортируем сами
      return rows
        .sort(
          (a, b) =>
            a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() ||
            a.createdAt.getTime() - b.createdAt.getTime(),
        )
        .map(({ nextAttemptAt: _, createdAt: __, ...row }): ClaimedMail => ({ ...row, claimId }))
    },

    /**
     * Продлевает аренду письма перед его отправкой. Пачка уходит по одному письму, и аренда
     * со времени забора могла истечь, пока шли письма перед ним. true — письмо по-прежнему наше,
     * и следующие SENDING_LEASE_MS его никто не возьмёт. false — его уже взял другой обработчик
     * (или failStale пометил неотправленным): отправлять нельзя, иначе письмо уйдёт дважды.
     * Условие по claim_id проверяется в том же UPDATE, что и продление, — между проверкой
     * и продлением письмо никто не перехватит. Это и есть начало попытки: lastAttemptAt
     * ставится здесь, а не при заборе пачки
     */
    async renewLease(mail: ClaimedMail, now: Date) {
      const rows = await db
        .update(mailOutbox)
        .set({ lockedUntil: new Date(now.getTime() + SENDING_LEASE_MS), lastAttemptAt: now })
        .where(and(claimed(mail), eq(mailOutbox.status, 'sending')))
        .returning({ id: mailOutbox.id })
      return rows.length > 0
    },

    /**
     * Письма, которые застряли в sending с истёкшей арендой, а попытки кончились: обработчик
     * падал посреди отправки снова и снова. Такие больше не берём — помечаем неотправленными
     */
    failStale({ now, maxAttempts }: { now: Date; maxAttempts: number }) {
      return db
        .update(mailOutbox)
        .set({
          status: 'failed',
          claimId: null,
          lockedUntil: null,
          data: dataAfterFailure,
          lastError:
            'Отправка прерывалась (API останавливался посреди отправки), а попытки кончились',
        })
        .where(
          and(
            eq(mailOutbox.status, 'sending'),
            lte(mailOutbox.lockedUntil, now),
            gte(mailOutbox.attempts, maxAttempts),
          ),
        )
    },

    /**
     * Письма с одноразовой ссылкой, срок которой вышел, пока письмо ждало: отправлять их
     * бессмысленно. Помечаются неотправленными, данные со ссылкой стираются. Письмо, которое
     * прямо сейчас отправляется (аренда не истекла), не трогаем
     */
    expireLinks(now: Date) {
      return db
        .update(mailOutbox)
        .set({
          status: 'failed',
          claimId: null,
          lockedUntil: null,
          data: null,
          lastError: 'Ссылка в письме истекла, пока письмо ждало отправки: письмо не отправлено',
        })
        .where(
          and(
            lte(mailOutbox.expiresAt, now),
            or(
              eq(mailOutbox.status, 'pending'),
              and(eq(mailOutbox.status, 'sending'), lte(mailOutbox.lockedUntil, now)),
            ),
          ),
        )
    },

    /**
     * Отпустить взятое письмо, не отправляя: попытка не считается, письмо снова ждёт очереди.
     * error — почему не ушло, если пробовали, но виновато не письмо (сервер не принял адрес
     * отправителя): причину видно в очереди, а попытка всё равно не тратится
     */
    async release(mail: ClaimedMail, now: Date, error?: string) {
      await db
        .update(mailOutbox)
        .set({
          status: 'pending',
          attempts: sql`${mailOutbox.attempts} - 1`,
          nextAttemptAt: now,
          claimId: null,
          lockedUntil: null,
          ...(error === undefined ? {} : { lastError: error.slice(0, 1000) }),
        })
        .where(claimed(mail))
    },

    /** Письмо ушло: данные больше не нужны и стираются — в них персональные данные и секреты */
    async markSent(mail: ClaimedMail, { now, messageId }: { now: Date; messageId: string }) {
      await db
        .update(mailOutbox)
        .set({
          status: 'sent',
          sentAt: now,
          messageId,
          data: null,
          lastError: null,
          claimId: null,
          lockedUntil: null,
        })
        .where(claimed(mail))
    },

    /**
     * Попытка не удалась. Постоянный отказ или последняя попытка — письмо окончательно
     * не отправлено (данные с одноразовой ссылкой стираются), иначе ждёт следующей попытки
     * с растущей паузой
     */
    async markFailedAttempt(
      mail: ClaimedMail,
      {
        now,
        error,
        permanent,
        maxAttempts,
      }: { now: Date; error: string; permanent: boolean; maxAttempts: number },
    ) {
      const giveUp = permanent || mail.attempts >= maxAttempts
      await db
        .update(mailOutbox)
        .set({
          status: giveUp ? 'failed' : 'pending',
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(mail.attempts)),
          lastError: error.slice(0, 1000),
          claimId: null,
          lockedUntil: null,
          ...(giveUp && !keepsDataOnFailure(mail.template) ? { data: null } : {}),
        })
        .where(claimed(mail))
      return giveUp ? 'failed' : 'retry'
    },

    /**
     * Удаляет письма старше retentionDays: отправленные — по времени отправки, окончательно
     * не отправленные — по последней попытке, а так и не ушедшие (почта была выключена или
     * обработчик не работал) — по времени постановки. В письмах персональные данные (152-ФЗ):
     * дольше срока они не лежат ни в каком статусе
     */
    async cleanup({ now, retentionDays }: { now: Date; retentionDays: number }) {
      const before = new Date(now.getTime() - retentionDays * 24 * 60 * MINUTE)
      const deleted = await db
        .delete(mailOutbox)
        .where(
          or(
            and(eq(mailOutbox.status, 'sent'), lt(mailOutbox.sentAt, before)),
            and(
              eq(mailOutbox.status, 'failed'),
              lt(sql`coalesce(${mailOutbox.lastAttemptAt}, ${mailOutbox.createdAt})`, before),
            ),
            and(
              inArray(mailOutbox.status, ['pending', 'sending']),
              lt(mailOutbox.createdAt, before),
            ),
          ),
        )
        .returning({ id: mailOutbox.id })
      return deleted.length
    },

    /**
     * Последние письма для админки, новые сверху. Без data: там персональные данные.
     * canRetry — можно ли вернуть письмо в очередь кнопкой (см. retry)
     */
    async list({ now, limit = 100 }: { now: Date; limit?: number }) {
      const rows = await db
        .select({
          id: mailOutbox.id,
          siteId: mailOutbox.siteId,
          template: mailOutbox.template,
          recipient: mailOutbox.recipient,
          status: mailOutbox.status,
          attempts: mailOutbox.attempts,
          nextAttemptAt: mailOutbox.nextAttemptAt,
          lastError: mailOutbox.lastError,
          lastAttemptAt: mailOutbox.lastAttemptAt,
          sentAt: mailOutbox.sentAt,
          expiresAt: mailOutbox.expiresAt,
          createdAt: mailOutbox.createdAt,
          hasData: sql<boolean>`${mailOutbox.data} IS NOT NULL`,
        })
        .from(mailOutbox)
        .orderBy(desc(mailOutbox.createdAt), desc(mailOutbox.id))
        .limit(limit)
      return rows.map(({ hasData, ...row }) => ({
        ...row,
        canRetry:
          (row.status === 'pending' || row.status === 'failed') &&
          hasData &&
          (row.expiresAt === null || row.expiresAt > now),
      }))
    },

    /**
     * Вернуть письмо в очередь сейчас, с попытками с нуля. Только ждущее или неотправленное
     * и только с данными: отправленное ушло, отправляющееся держит обработчик ('busy'),
     * а у письма с одноразовой ссылкой после неудачи или срока данных нет ('gone') —
     * человеку нужна новая ссылка, а не старое письмо
     */
    async retry(id: string, now: Date) {
      const [row] = await db
        .update(mailOutbox)
        .set({
          status: 'pending',
          attempts: 0,
          nextAttemptAt: now,
          claimId: null,
          lockedUntil: null,
        })
        .where(
          and(
            eq(mailOutbox.id, id),
            inArray(mailOutbox.status, ['pending', 'failed']),
            isNotNull(mailOutbox.data),
            or(isNull(mailOutbox.expiresAt), gt(mailOutbox.expiresAt, now)),
          ),
        )
        .returning({ id: mailOutbox.id })
      if (row) return 'queued' as const
      const [exists] = await db
        .select({ status: mailOutbox.status })
        .from(mailOutbox)
        .where(eq(mailOutbox.id, id))
      if (!exists) return 'not_found' as const
      return exists.status === 'pending' || exists.status === 'failed'
        ? ('gone' as const)
        : ('busy' as const)
    },
  }
}

export type OutboxRepo = ReturnType<typeof outboxRepo>
