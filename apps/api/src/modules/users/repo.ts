import { MemberRole, NewPassword, UserEmail, UserName } from '@averra/schema'
import { and, asc, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Auth } from '../../auth/auth'
import { resetTokensOf } from '../../auth/password-reset'
import type { Db } from '../../db/client'
import { accounts, sessions, siteMembers, users, verifications } from '../../db/schema'
import type { DbOrTx } from '../../mail/outbox'

// Схемы почты, роли и пароля — общие с админкой (@averra/schema). Команды берут их отсюда
export { MemberRole, UserEmail }

/** Новый пользователь админки — для команды pnpm user:create и владельца для разработки */
export const NewUser = z.object({
  email: UserEmail,
  name: UserName,
  password: NewPassword,
  role: z.enum(['owner', 'member'], 'Роль — owner или member').default('owner'),
})
export type NewUser = z.input<typeof NewUser>

/** Пользователь с уже готовым хешем пароля: для вставки внутри чужой транзакции */
type UserRow = { email: string; name: string; role: 'owner' | 'member'; passwordHash: string }

/**
 * Пользователь и его вход по паролю тем объектом базы или транзакции, что передали: без
 * второй записи он не войдёт. Почта занята — undefined. Так Better Auth хранит вход
 * по паролю: provider_id = credential, account_id = id пользователя
 */
export async function insertUser(tx: DbOrTx, { email, name, role, passwordHash }: UserRow) {
  const [user] = await tx
    .insert(users)
    // Почта подтверждена: пользователя завёл владелец или он пришёл по ссылке из письма
    .values({ email, name, role, emailVerified: true })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role })
  if (!user) return undefined
  await tx.insert(accounts).values({
    userId: user.id,
    accountId: user.id,
    providerId: 'credential',
    password: passwordHash,
  })
  return user
}

/** Даёт участнику роль на сайте. Повторный вызов меняет роль */
export async function upsertMember(
  tx: DbOrTx,
  siteId: string,
  userId: string,
  role: z.infer<typeof MemberRole>,
) {
  await tx
    .insert(siteMembers)
    .values({ siteId, userId, role })
    .onConflictDoUpdate({ target: [siteMembers.siteId, siteMembers.userId], set: { role } })
}

/**
 * Даёт участнику роль на сайте, только если доступа ещё нет. Уже участник — роль не трогает
 * и возвращает false: так старое приглашение не перепишет роль, которую владелец выдал позже
 */
export async function addMemberIfAbsent(
  tx: DbOrTx,
  siteId: string,
  userId: string,
  role: z.infer<typeof MemberRole>,
) {
  const inserted = await tx
    .insert(siteMembers)
    .values({ siteId, userId, role })
    .onConflictDoNothing({ target: [siteMembers.siteId, siteMembers.userId] })
    .returning({ role: siteMembers.role })
  return inserted.length > 0
}

export function usersRepo(db: Db, auth: Auth) {
  /** Хеширует пароль сам Better Auth — тем же способом, каким потом проверит его при входе */
  const hashPassword = async (password: string) => (await auth.$context).password.hash(password)

  return {
    hashPassword,

    /** Пользователь с паролем — одной транзакцией. Почта занята — undefined */
    async create(input: NewUser) {
      const { email, name, password, role } = NewUser.parse(input)
      const passwordHash = await hashPassword(password)
      return db.transaction((tx) => insertUser(tx, { email, name, role, passwordHash }))
    },

    async count() {
      const [row] = await db.select({ value: count() }).from(users)
      return row?.value ?? 0
    },

    async findByEmail(email: string) {
      const [user] = await db
        .select({ id: users.id, email: users.email, name: users.name, role: users.role })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
      return user
    },

    owners() {
      return db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.role, 'owner'))
        .orderBy(asc(users.createdAt))
    },

    /**
     * Новый пароль — как после сброса по почте: хеш пароля меняется (или появляется вход
     * по паролю, если его не было), все сессии пользователя завершаются, его ссылки сброса
     * сгорают. Для pnpm user:password, когда почты нет или владелец остался без пароля
     */
    async setPassword(userId: string, password: string) {
      const passwordHash = await hashPassword(NewPassword.parse(password))
      await db.transaction(async (tx) => {
        const credential = and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential'))
        const updated = await tx
          .update(accounts)
          .set({ password: passwordHash, updatedAt: new Date() })
          .where(credential)
          .returning({ id: accounts.id })
        if (updated.length === 0) {
          await tx
            .insert(accounts)
            .values({ userId, accountId: userId, providerId: 'credential', password: passwordHash })
        }
        await tx.delete(sessions).where(eq(sessions.userId, userId))
        await tx.delete(verifications).where(resetTokensOf(userId))
      })
    },

    /** Даёт участнику роль на сайте. Повторный вызов меняет роль */
    addMember: (siteId: string, userId: string, role: z.infer<typeof MemberRole>) =>
      upsertMember(db, siteId, userId, role),
  }
}
