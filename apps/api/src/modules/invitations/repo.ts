import { constantTimeEqual } from 'better-auth/crypto'
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { sites, userInvitations, users } from '../../db/schema'
import type { InvitationProblem } from '../../errors'
import type { DbOrTx } from '../../mail/outbox'
import { randomSecret, sha256 } from '../../secrets'

// Токен приглашения: inv_<id строки в user_invitations>_<секрет: 32 случайных байта в hex>.
// Как у токенов API: строка находится по id, а секрет сверяется сравнением хешей
// за постоянное время. В базе только хеш, сам токен есть только в письме
const TOKEN_FORMAT =
  /^inv_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_[0-9a-f]{64}$/

/** Сколько живёт приглашение: по плану — 7 дней */
export const INVITATION_TTL_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/** Что видит владелец в списке: ждёт, принято, отозвано или истекло */
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

type InvitationDates = {
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
}

/**
 * Состояние из полей. Отзыв уже истёкшего (так его отзывает повторное приглашение) — всё
 * равно «истекло»: человеку важнее, что срок прошёл, чем что его потом закрыли
 */
export function invitationStatus(row: InvitationDates, now: Date): InvitationStatus {
  if (row.acceptedAt) return 'accepted'
  if (row.revokedAt) return row.revokedAt >= row.expiresAt ? 'expired' : 'revoked'
  return row.expiresAt <= now ? 'expired' : 'pending'
}

/** Почему по этому приглашению уже не войти. undefined — оно действует */
export function invitationProblem(row: InvitationDates, now: Date): InvitationProblem | undefined {
  const status = invitationStatus(row, now)
  if (status === 'accepted') return 'used'
  if (status === 'pending') return undefined
  return status
}

/** Только открытое приглашение: ни принято, ни отозвано, срок не прошёл */
const isOpen = (now: Date) =>
  and(
    isNull(userInvitations.acceptedAt),
    isNull(userInvitations.revokedAt),
    gt(userInvitations.expiresAt, now),
  )

export function invitationsRepo(db: Db) {
  return {
    /**
     * Новое приглашение тем объектом базы или транзакции, что и письмо с ним. Прежнее
     * открытое приглашение этого адреса на этот сайт отзывается: его ссылка больше не работает.
     * Возвращает строку и токен — токен нужен только для письма
     */
    async create(
      tx: DbOrTx,
      input: {
        siteId: string
        email: string
        role: 'editor' | 'client'
        invitedBy?: string | undefined
        now: Date
      },
    ) {
      const { siteId, email, role, invitedBy, now } = input
      await tx
        .update(userInvitations)
        .set({ revokedAt: now })
        .where(
          and(
            eq(userInvitations.siteId, siteId),
            eq(userInvitations.email, email),
            isNull(userInvitations.acceptedAt),
            isNull(userInvitations.revokedAt),
          ),
        )
      const id = crypto.randomUUID()
      const token = `inv_${id}_${randomSecret()}`
      const [row] = await tx
        .insert(userInvitations)
        .values({
          id,
          siteId,
          email,
          role,
          tokenHash: await sha256(token),
          invitedBy,
          createdAt: now,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * DAY_MS),
        })
        .returning({ id: userInvitations.id, expiresAt: userInvitations.expiresAt })
      if (!row) throw new Error('База не вернула приглашение')
      return { ...row, token }
    },

    /**
     * Приглашение по токену из ссылки — в любом состоянии: что с ним не так, решает вызывающий.
     * Чужой формат, нет такого id или секрет не совпал — undefined
     */
    async findByToken(token: string) {
      const id = TOKEN_FORMAT.exec(token)?.[1]
      if (!id) return undefined
      const [row] = await db
        .select({
          id: userInvitations.id,
          siteId: userInvitations.siteId,
          siteName: sites.name,
          email: userInvitations.email,
          role: userInvitations.role,
          tokenHash: userInvitations.tokenHash,
          inviterName: users.name,
          expiresAt: userInvitations.expiresAt,
          acceptedAt: userInvitations.acceptedAt,
          revokedAt: userInvitations.revokedAt,
        })
        .from(userInvitations)
        .innerJoin(sites, eq(sites.id, userInvitations.siteId))
        .leftJoin(users, eq(users.id, userInvitations.invitedBy))
        .where(eq(userInvitations.id, id))
      if (!row || !constantTimeEqual(await sha256(token), row.tokenHash)) return undefined
      const { tokenHash: _, ...invitation } = row
      return invitation
    },

    /**
     * Принять: одним условным UPDATE. Строку получает только первый запрос, пока приглашение
     * открыто, — второй (даже одновременный) получит undefined. Так ссылка одноразовая
     */
    async accept(tx: DbOrTx, { id, userId, now }: { id: string; userId: string; now: Date }) {
      const [row] = await tx
        .update(userInvitations)
        .set({ acceptedAt: now, acceptedBy: userId })
        .where(and(eq(userInvitations.id, id), isOpen(now)))
        .returning({ id: userInvitations.id })
      return row
    },

    /** Состояние приглашения сейчас: после неудачного accept — объяснить, почему */
    async problemOf(id: string, now: Date): Promise<InvitationProblem> {
      const [row] = await db
        .select({
          expiresAt: userInvitations.expiresAt,
          acceptedAt: userInvitations.acceptedAt,
          revokedAt: userInvitations.revokedAt,
        })
        .from(userInvitations)
        .where(eq(userInvitations.id, id))
      return row ? (invitationProblem(row, now) ?? 'used') : 'not_found'
    },

    /** Последние 100 приглашений сайта, новые сверху. Без хеша токена */
    async list(siteId: string, now: Date) {
      const rows = await db
        .select({
          id: userInvitations.id,
          email: userInvitations.email,
          role: userInvitations.role,
          invitedBy: users.name,
          createdAt: userInvitations.createdAt,
          expiresAt: userInvitations.expiresAt,
          acceptedAt: userInvitations.acceptedAt,
          revokedAt: userInvitations.revokedAt,
        })
        .from(userInvitations)
        .leftJoin(users, eq(users.id, userInvitations.invitedBy))
        .where(eq(userInvitations.siteId, siteId))
        .orderBy(desc(userInvitations.createdAt))
        .limit(100)
      return rows.map((row) => ({ ...row, status: invitationStatus(row, now) }))
    },

    /**
     * Удаляет закрытые приглашения, закрытые раньше before: принятые — по времени принятия,
     * отозванные — по времени отзыва, истёкшие — по сроку. В строке адрес человека (152-ФЗ:
     * храним не дольше, чем нужно), а работающей ссылки за ней уже нет. Открытые не трогает
     */
    async cleanup(before: Date) {
      const deleted = await db
        .delete(userInvitations)
        .where(
          or(
            lt(userInvitations.acceptedAt, before),
            lt(userInvitations.revokedAt, before),
            and(
              isNull(userInvitations.acceptedAt),
              isNull(userInvitations.revokedAt),
              lt(userInvitations.expiresAt, before),
            ),
          ),
        )
        .returning({ id: userInvitations.id })
      return deleted.length
    },

    /**
     * Отозвать. Повторный отзыв ничего не меняет (время первого остаётся), принятое не отзывается:
     * доступ уже выдан. Приглашение другого сайта — как несуществующее
     */
    async revoke(siteId: string, id: string, now: Date) {
      const where = and(eq(userInvitations.id, id), eq(userInvitations.siteId, siteId))
      // Сначала условный UPDATE, потом объяснение: между проверкой и отзывом приглашение
      // могли принять, и отзыв не должен лечь поверх принятого
      const [revoked] = await db
        .update(userInvitations)
        .set({ revokedAt: now })
        .where(and(where, isNull(userInvitations.acceptedAt), isNull(userInvitations.revokedAt)))
        .returning({ id: userInvitations.id })
      if (revoked) return 'revoked' as const
      const [row] = await db
        .select({ acceptedAt: userInvitations.acceptedAt })
        .from(userInvitations)
        .where(where)
      if (!row) return 'not_found' as const
      return row.acceptedAt ? ('accepted' as const) : ('revoked' as const)
    },
  }
}

export type InvitationsRepo = ReturnType<typeof invitationsRepo>
