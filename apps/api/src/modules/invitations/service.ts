import { and, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { siteMembers, sites, users } from '../../db/schema'
import { enqueueMail } from '../../mail/outbox'
import { toMailLine } from '../../mail/templates/line'
import { addMemberIfAbsent, insertUser, upsertMember } from '../users/repo'
import { INVITATION_TTL_DAYS, invitationProblem, invitationsRepo } from './repo'

// Приглашения участников: общая логика маршрутов API и команды pnpm member:invite

/**
 * Ссылка из письма: экран админки, токен — во фрагменте (#). Фрагмент браузер не шлёт
 * на сервер, поэтому токен не попадает в логи статики и прокси и в заголовок Referer
 */
const invitationLink = (adminUrl: string, token: string) =>
  `${adminUrl}/invite#token=${encodeURIComponent(token)}`

type NewInvitationInput = {
  siteId: string
  email: string
  role: 'editor' | 'client'
  /** Кто приглашает. Нет — команда без владельцев в базе */
  inviter?: { id: string; name: string } | undefined
  adminUrl: string
  now?: Date
}

/**
 * Приглашает участника: строка приглашения и письмо со ссылкой — одной транзакцией.
 * Владельца не приглашают (ему открыты все сайты), участника сайта — тоже: роль меняет
 * pnpm member:add. Прежнее открытое приглашение адреса на сайт отзывается
 */
export async function createInvitation(db: Db, input: NewInvitationInput) {
  const { siteId, email, role, inviter, adminUrl, now = new Date() } = input
  const [site] = await db.select({ name: sites.name }).from(sites).where(eq(sites.id, siteId))
  if (!site) return { ok: false as const, problem: 'site_not_found' as const }

  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, email))
  if (user?.role === 'owner') return { ok: false as const, problem: 'owner' as const }
  if (user) {
    const [member] = await db
      .select({ role: siteMembers.role })
      .from(siteMembers)
      .where(and(eq(siteMembers.siteId, siteId), eq(siteMembers.userId, user.id)))
    if (member) return { ok: false as const, problem: 'member' as const, role: member.role }
  }

  const repo = invitationsRepo(db)
  const invitation = await db.transaction(async (tx) => {
    const created = await repo.create(tx, { siteId, email, role, invitedBy: inviter?.id, now })
    await enqueueMail(
      tx,
      {
        template: 'invitation',
        data: {
          inviterName: toMailLine(inviter?.name ?? 'Владелец Averra CMS', 100, 'Владелец'),
          siteName: toMailLine(site.name, 80, 'сайт'),
          role,
          url: invitationLink(adminUrl, created.token),
          expiresInDays: INVITATION_TTL_DAYS,
        },
        to: email,
        siteId,
      },
      now,
    )
    return created
  })
  return { ok: true as const, invitation: { id: invitation.id, expiresAt: invitation.expiresAt } }
}

/** Что сказать экрану принятия: сайт, роль, кто пригласил и есть ли уже вход у этого адреса */
export async function lookupInvitation(db: Db, token: string, now = new Date()) {
  const invitation = await invitationsRepo(db).findByToken(token)
  if (!invitation) return { ok: false as const, problem: 'not_found' as const }
  const problem = invitationProblem(invitation, now)
  if (problem) return { ok: false as const, problem }
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, invitation.email))
  return {
    ok: true as const,
    invitation: {
      email: invitation.email,
      role: invitation.role,
      siteName: invitation.siteName,
      inviterName: invitation.inviterName,
      expiresAt: invitation.expiresAt,
      userExists: user !== undefined,
    },
  }
}

/**
 * Приглашение кончилось между проверкой и записью: откатывает транзакцию. Почему — спрашиваем
 * уже после неё: встроенная база (PGlite) не выполнит запрос мимо открытой транзакции
 */
class InvitationGone extends Error {}

/** Пользователь с этим адресом появился между проверкой и записью: откатывает транзакцию */
class UserExists extends Error {}

type Register = {
  token: string
  name: string
  password: string
  /**
   * Хеш пароля — Better Auth (usersRepo.hashPassword). Считается только для действующей ссылки
   * (это дорого: scrypt) и до транзакции: она держит базу
   */
  hashPassword: (password: string) => Promise<string>
  now?: Date
}

/**
 * Новый пользователь по приглашению: пользователь, вход по паролю, доступ к сайту и отметка
 * «принято» — одной транзакцией. Уже есть пользователь с этим адресом — 'user_exists':
 * ему надо войти и принять приглашение (acceptInvitation)
 */
export async function registerByInvitation(
  db: Db,
  { token, name, password, hashPassword, now = new Date() }: Register,
) {
  const repo = invitationsRepo(db)
  const invitation = await repo.findByToken(token)
  if (!invitation) return { ok: false as const, problem: 'not_found' as const }
  const problem = invitationProblem(invitation, now)
  if (problem) return { ok: false as const, problem }

  // Без проверенной ссылки хеш не считаем: иначе открытый маршрут грузил бы процессор по любому
  // запросу
  const passwordHash = await hashPassword(password)
  try {
    const user = await db.transaction(async (tx) => {
      const created = await insertUser(tx, {
        email: invitation.email,
        name,
        role: 'member',
        passwordHash,
      })
      if (!created) throw new UserExists()
      const accepted = await repo.accept(tx, { id: invitation.id, userId: created.id, now })
      if (!accepted) throw new InvitationGone()
      await upsertMember(tx, invitation.siteId, created.id, invitation.role)
      return created
    })
    return { ok: true as const, siteId: invitation.siteId, email: user.email }
  } catch (error) {
    if (error instanceof UserExists) return { ok: false as const, problem: 'user_exists' as const }
    if (error instanceof InvitationGone) {
      return { ok: false as const, problem: await repo.problemOf(invitation.id, now) }
    }
    throw error
  }
}

type Accept = {
  token: string
  /** Кто вошёл: принять может только пользователь с тем же адресом */
  user: { id: string; email: string; role: 'owner' | 'member' }
  now?: Date
}

/**
 * Приглашение принимает тот, под кем вошли: доступ к сайту с ролью из приглашения и отметка
 * «принято». Другой адрес — 'wrong_user'. Владельцу доступ не нужен (ему открыто всё), но
 * приглашение всё равно гасится: ссылка одноразовая. Уже участник сайта (владелец выдал роль
 * командой pnpm member:add после приглашения) — роль не меняется: последнее решение владельца
 * важнее старой ссылки, а приглашение тоже гасится
 */
export async function acceptInvitation(db: Db, { token, user, now = new Date() }: Accept) {
  const repo = invitationsRepo(db)
  const invitation = await repo.findByToken(token)
  if (!invitation) return { ok: false as const, problem: 'not_found' as const }
  const problem = invitationProblem(invitation, now)
  if (problem) return { ok: false as const, problem }
  if (invitation.email !== user.email.toLowerCase()) {
    return { ok: false as const, problem: 'wrong_user' as const, email: invitation.email }
  }

  try {
    await db.transaction(async (tx) => {
      const accepted = await repo.accept(tx, { id: invitation.id, userId: user.id, now })
      if (!accepted) throw new InvitationGone()
      if (user.role === 'member') {
        await addMemberIfAbsent(tx, invitation.siteId, user.id, invitation.role)
      }
    })
    return { ok: true as const, siteId: invitation.siteId }
  } catch (error) {
    if (error instanceof InvitationGone) {
      return { ok: false as const, problem: await repo.problemOf(invitation.id, now) }
    }
    throw error
  }
}
