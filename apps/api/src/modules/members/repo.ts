import type { SiteRoleKey } from '@averra/schema'
import { and, asc, count, eq, isNotNull, isNull } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { apiTokens, sessions, siteMembers, users } from '../../db/schema'
import type { DbOrTx } from '../../mail/outbox'

// Участники сайта: владельцы установки (users.role = owner) и участники сайта (site_members),
// плюс отключённые (users.disabled_at). Правила, кто кого меняет, — в routes.ts и access.ts

/** Участник в списке: роль на сайте или null, если доступ отключён */
export type MemberRow = {
  id: string
  name: string
  email: string
  role: SiteRoleKey | null
  disabledAt: Date | null
  /** Роль до отключения (у действующих — null): кто может вернуть доступ */
  disabledRole: SiteRoleKey | null
  /** С какого времени человек в админке: пользователь или его доступ к сайту */
  since: Date
  /**
   * Сколько рабочих (не отозванных) токенов API он выпустил. Токены от входа не зависят:
   * отключение и смена роли их не гасят, поэтому окна об этом предупреждают по этому числу, а не
   * по нынешней роли (токены мог выпустить владелец, которого потом понизили)
   */
  activeTokens: number
}

/** Последнего владельца не стало: откатывает транзакцию. Проверяем после изменения, в ней же */
export class LastOwnerError extends Error {}

/**
 * Блокирует строки владельцев до конца транзакции. Без этого при READ COMMITTED два владельца,
 * одновременно понижающие друг друга, оба видят второго владельцем — и установка остаётся без
 * владельца. С блокировкой второе изменение ждёт первое и считает владельцев уже после него
 */
async function lockOwners(tx: DbOrTx) {
  await tx.select({ id: users.id }).from(users).where(eq(users.role, 'owner')).for('update')
}

/** Сколько владельцев с доступом осталось */
async function activeOwners(tx: DbOrTx) {
  const [row] = await tx
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.role, 'owner'), isNull(users.disabledAt)))
  return row?.value ?? 0
}

/**
 * Ставит роль на сайте. Владелец — роль пользователя (ему открыта вся установка, строка
 * site_members не нужна и удаляется), участник — роль member и строка site_members. После —
 * проверка, что владелец остался
 */
async function applyRole(tx: DbOrTx, siteId: string, userId: string, role: SiteRoleKey) {
  if (role === 'owner') {
    await tx.update(users).set({ role: 'owner', updatedAt: new Date() }).where(eq(users.id, userId))
    await tx.delete(siteMembers).where(eq(siteMembers.userId, userId))
  } else {
    await tx
      .update(users)
      .set({ role: 'member', updatedAt: new Date() })
      .where(eq(users.id, userId))
    await tx
      .insert(siteMembers)
      .values({ siteId, userId, role })
      .onConflictDoUpdate({ target: [siteMembers.siteId, siteMembers.userId], set: { role } })
  }
  if ((await activeOwners(tx)) === 0) throw new LastOwnerError()
}

export function membersRepo(db: Db) {
  return {
    /**
     * Все, кто работает с сайтом: владельцы, участники сайта и отключённые. Отключённые — без
     * роли: доступ им вернут с выбором роли. Сначала владельцы, потом остальные по времени
     */
    async list(siteId: string): Promise<MemberRow[]> {
      const owners = await db
        .select({ id: users.id, name: users.name, email: users.email, since: users.createdAt })
        .from(users)
        .where(and(eq(users.role, 'owner'), isNull(users.disabledAt)))
        .orderBy(asc(users.createdAt))
      const members = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: siteMembers.role,
          since: siteMembers.createdAt,
        })
        .from(siteMembers)
        .innerJoin(users, eq(users.id, siteMembers.userId))
        .where(and(eq(siteMembers.siteId, siteId), isNull(users.disabledAt)))
        .orderBy(asc(siteMembers.createdAt))
      // Отключённые — все в установке: сайт у неё один, а строки site_members у них нет
      const disabled = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          since: users.createdAt,
          disabledAt: users.disabledAt,
          disabledRole: users.disabledRole,
        })
        .from(users)
        .where(isNotNull(users.disabledAt))
        .orderBy(asc(users.createdAt))
      const tokenRows = await db
        .select({ userId: apiTokens.createdBy, value: count() })
        .from(apiTokens)
        .where(and(isNull(apiTokens.revokedAt), isNotNull(apiTokens.createdBy)))
        .groupBy(apiTokens.createdBy)
      const tokens = new Map(tokenRows.map((row) => [row.userId, row.value]))
      const withTokens = <T extends { id: string }>(row: T) => ({
        ...row,
        activeTokens: tokens.get(row.id) ?? 0,
      })
      return [
        ...owners.map((row) =>
          withTokens({ ...row, role: 'owner' as const, disabledAt: null, disabledRole: null }),
        ),
        ...members.map((row) => withTokens({ ...row, disabledAt: null, disabledRole: null })),
        ...disabled.map((row) => withTokens({ ...row, role: null })),
      ]
    },

    async find(siteId: string, userId: string) {
      return (await this.list(siteId)).find((member) => member.id === userId)
    },

    /** Новая роль действующего участника. Последний владелец — LastOwnerError */
    setRole: (siteId: string, userId: string, role: SiteRoleKey) =>
      db.transaction(async (tx) => {
        await lockOwners(tx)
        await applyRole(tx, siteId, userId, role)
      }),

    /**
     * Отключить: отметка с прежней ролью, роль member, доступ ко всем сайтам и все сессии — одной
     * транзакцией. Второй браузер человека получит 401 на следующем же запросе, войти снова не
     * даст Better Auth (auth/auth.ts). Последний владелец — LastOwnerError
     */
    disable: (userId: string, role: SiteRoleKey, now = new Date()) =>
      db.transaction(async (tx) => {
        await lockOwners(tx)
        await tx
          .update(users)
          .set({ disabledAt: now, disabledRole: role, role: 'member', updatedAt: now })
          .where(eq(users.id, userId))
        await tx.delete(siteMembers).where(eq(siteMembers.userId, userId))
        await tx.delete(sessions).where(eq(sessions.userId, userId))
        if ((await activeOwners(tx)) === 0) throw new LastOwnerError()
      }),

    /** Вернуть доступ с ролью */
    restore: (siteId: string, userId: string, role: SiteRoleKey) =>
      db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ disabledAt: null, disabledRole: null })
          .where(eq(users.id, userId))
        await applyRole(tx, siteId, userId, role)
      }),

    /**
     * Передать владение: тот становится владельцем, а прежний — администратором сайта. Одной
     * транзакцией: владелец есть всё время
     */
    transfer: (siteId: string, fromId: string, toId: string) =>
      db.transaction(async (tx) => {
        await lockOwners(tx)
        await applyRole(tx, siteId, toId, 'owner')
        await applyRole(tx, siteId, fromId, 'client')
      }),
  }
}
