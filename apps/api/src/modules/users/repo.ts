import { asc, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Auth } from '../../auth/auth'
import { PASSWORD_LENGTH } from '../../auth/auth'
import type { Db } from '../../db/client'
import { accounts, siteMembers, users } from '../../db/schema'

export const UserEmail = z
  .email('Нужна почта вида name@example.ru')
  .transform((email) => email.toLowerCase())

/** Новый пользователь админки — для команды pnpm user:create и владельца для разработки */
export const NewUser = z.object({
  email: UserEmail,
  name: z.string().trim().min(1).max(80),
  password: z
    .string()
    .min(PASSWORD_LENGTH.min, `Пароль — от ${PASSWORD_LENGTH.min} символов`)
    .max(PASSWORD_LENGTH.max, `Пароль — до ${PASSWORD_LENGTH.max} символов`),
  role: z.enum(['owner', 'member']).default('owner'),
})
export type NewUser = z.input<typeof NewUser>

export const MemberRole = z.enum(['editor', 'client'])

export function usersRepo(db: Db, auth: Auth) {
  return {
    /**
     * Пользователь и его вход по паролю — одной транзакцией: без второй записи он не войдёт.
     * Хеширует пароль сам Better Auth, тем же способом, каким потом проверит его при входе.
     * Почта занята — undefined
     */
    async create(input: NewUser) {
      const { email, name, password, role } = NewUser.parse(input)
      const { password: hasher } = await auth.$context
      const passwordHash = await hasher.hash(password)
      return db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email, name, role, emailVerified: true })
          .onConflictDoNothing({ target: users.email })
          .returning({ id: users.id, email: users.email, name: users.name, role: users.role })
        if (!user) return undefined
        // Так Better Auth хранит вход по паролю: provider_id = credential, account_id = id
        await tx.insert(accounts).values({
          userId: user.id,
          accountId: user.id,
          providerId: 'credential',
          password: passwordHash,
        })
        return user
      })
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
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.role, 'owner'))
        .orderBy(asc(users.createdAt))
    },

    /** Даёт участнику роль на сайте. Повторный вызов меняет роль */
    async addMember(siteId: string, userId: string, role: z.infer<typeof MemberRole>) {
      await db
        .insert(siteMembers)
        .values({ siteId, userId, role })
        .onConflictDoUpdate({ target: [siteMembers.siteId, siteMembers.userId], set: { role } })
    },
  }
}
