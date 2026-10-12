import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { siteMembers, sites } from '../db/schema'

export type UserRole = 'owner' | 'member'
export type MemberRole = 'editor' | 'client'
/** Роль на конкретном сайте: владелец — на любом, участник — по site_members, токен — editor */
export type SiteRole = 'owner' | MemberRole

export type SessionUser = { id: string; name: string; email: string; role: UserRole }

/** Кто делает запрос: человек из админки (cookie) или программа с токеном (MCP) */
export type Actor =
  | { kind: 'user'; user: SessionUser }
  | { kind: 'token'; tokenId: string; siteId: string }

/**
 * Что можно делать на сайте. Одна таблица на все маршруты: маршрут объявляет действие,
 * а решает эта таблица. Токен MCP получает права редактора на своём сайте
 */
const permissions = {
  'site.read': ['owner', 'editor', 'client'],
  'page.edit': ['owner', 'editor', 'client'],
  // Клиент не может удалить страницу, поэтому и создавать её ему незачем
  'page.create': ['owner', 'editor'],
  'page.publish': ['owner', 'editor'],
  'page.delete': ['owner', 'editor'],
  // Картинки — как страницы: клиент правит свой сайт, значит, и картинки для него грузит,
  // а удалять, как и страницы, может владелец или редактор
  'media.upload': ['owner', 'editor', 'client'],
  'media.delete': ['owner', 'editor'],
} as const satisfies Record<string, readonly SiteRole[]>

export type Permission = keyof typeof permissions

export function can(role: SiteRole, permission: Permission) {
  return (permissions[permission] as readonly SiteRole[]).includes(role)
}

/** Что не разрешено, человеческим языком — для 403 */
export const forbiddenMessages: Record<Permission, string> = {
  'site.read': 'Нет доступа к сайту',
  'page.edit': 'Править страницы этого сайта нельзя',
  'page.create': 'Создавать страницы может владелец или редактор сайта',
  'page.publish': 'Публиковать может владелец или редактор сайта',
  'page.delete': 'Удалять страницы может владелец или редактор сайта',
  'media.upload': 'Загружать картинки на этот сайт нельзя',
  'media.delete': 'Удалять картинки может владелец или редактор сайта',
}

/** Роль на сайте или undefined, если сайта нет или он чужой — снаружи это неразличимо */
export async function siteRoleOf(
  db: Db,
  actor: Actor,
  siteId: string,
): Promise<SiteRole | undefined> {
  if (actor.kind === 'token') return actor.siteId === siteId ? 'editor' : undefined

  if (actor.user.role === 'owner') {
    const [site] = await db.select({ id: sites.id }).from(sites).where(eq(sites.id, siteId))
    return site ? 'owner' : undefined
  }

  const [member] = await db
    .select({ role: siteMembers.role })
    .from(siteMembers)
    .where(and(eq(siteMembers.siteId, siteId), eq(siteMembers.userId, actor.user.id)))
  return member?.role
}
