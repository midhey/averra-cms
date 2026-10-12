import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '../../db/client'
import { migrateDb } from '../../db/migrate'
import { accounts, users } from '../../db/schema'
import { seedDevOwner } from '../../db/seed'
import { createTestApi } from '../../testing'
import { usersRepo } from './repo'

const api = await createTestApi()
const repo = usersRepo(api.db, api.auth)

afterAll(api.close)

const signIn = (email: string, password: string) =>
  api.app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

describe('создание пользователя', () => {
  it('создаёт владельца, который входит своим паролем; пароль в базе только хешем', async () => {
    const user = await repo.create({
      email: 'Owner@Example.Test',
      name: '  Анна  ',
      password: 'correct-horse-1',
    })
    expect(user).toMatchObject({ email: 'owner@example.test', name: 'Анна', role: 'owner' })
    if (!user) throw new Error('Пользователь не создался')

    const [account] = await api.db.select().from(accounts).where(eq(accounts.userId, user.id))
    expect(account).toMatchObject({ providerId: 'credential', accountId: user.id })
    expect(account?.password).toBeTruthy()
    expect(account?.password).not.toContain('correct-horse-1')

    expect((await signIn('owner@example.test', 'correct-horse-1')).status).toBe(200)
  })

  it('занятая почта (в любом регистре) — undefined, второй записи нет', async () => {
    await repo.create({ email: 'dup@example.test', name: 'Первый', password: 'password-123' })
    const again = await repo.create({
      email: 'DUP@example.test',
      name: 'Второй',
      password: 'password-456',
    })
    expect(again).toBeUndefined()
    const rows = await api.db.select().from(users).where(eq(users.email, 'dup@example.test'))
    expect(rows.map((row) => row.name)).toEqual(['Первый'])
  })

  it('короткий пароль и кривая почта не проходят схему', async () => {
    await expect(
      repo.create({ email: 'short@example.test', name: 'Коротко', password: 'short' }),
    ).rejects.toThrow(/от 10 символов/)
    await expect(
      repo.create({ email: 'not-an-email', name: 'Кривая', password: 'password-123' }),
    ).rejects.toThrow(/name@example.ru/)
  })

  it('роль участника — member, доступ к сайту даёт addMember', async () => {
    const member = await repo.create({
      email: 'member@example.test',
      name: 'Участник',
      password: 'password-123',
      role: 'member',
    })
    if (!member) throw new Error('Пользователь не создался')
    expect(member.role).toBe('member')
    await repo.addMember(api.demoSiteId, member.id, 'client')
    await repo.addMember(api.demoSiteId, member.id, 'editor')
    const headers = await api.sessionHeaders('member@example.test', 'password-123')
    const site = await api.app.request(`/api/sites/${api.demoSiteId}`, { headers })
    expect(await site.json()).toMatchObject({ access: 'editor' })
  })
})

describe('владелец для разработки', () => {
  const owner = { email: 'dev@example.test', password: 'dev-password-1' }

  it('создаётся только в базе без пользователей', async () => {
    const { db, close } = createDb()
    try {
      await migrateDb(db)
      expect(await seedDevOwner(db, api.auth, owner)).toBe('created')
      expect(await seedDevOwner(db, api.auth, { ...owner, email: 'second@example.test' })).toBe(
        'exists',
      )
      const rows = await db.select({ email: users.email, role: users.role }).from(users)
      expect(rows).toEqual([{ email: 'dev@example.test', role: 'owner' }])
    } finally {
      await close()
    }
  })

  it('без DEV_OWNER_* ничего не создаёт и говорит об этом', async () => {
    const { db, close } = createDb()
    try {
      await migrateDb(db)
      expect(await seedDevOwner(db, api.auth, undefined)).toBe('missing')
      expect(await db.select().from(users)).toEqual([])
    } finally {
      await close()
    }
  })
})
