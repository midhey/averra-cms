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
  // Раздавать доступ к сайту (приглашения) — решение владельца студии, а не участника
  'members.invite': ['owner'],
  // Заявки с форм — персональные данные посетителей. Их видит и обрабатывает клиент: это его
  // бизнес и его заявки (оператор персональных данных), и владелец студии. Редактору, который
  // делает контент, они не нужны. Токену API (MCP) — никогда, см. personalData
  'leads.read': ['owner', 'client'],
  // «Обработана», удаление (в том числе по просьбе посетителя)
  'leads.manage': ['owner', 'client'],
  // Куда уходят уведомления, сколько хранить заявки, подтверждать ли посетителю
  'leads.settings': ['owner', 'client'],
} as const satisfies Record<string, readonly SiteRole[]>

export type Permission = keyof typeof permissions

/**
 * Действия с персональными данными посетителей. Токену API в них отказано при любой таблице выше:
 * токен живёт в конфиге программы (MCP, нейронка), и через него персональные данные не уходят
 */
export const personalData: ReadonlySet<Permission> = new Set([
  'leads.read',
  'leads.manage',
  'leads.settings',
])

export const TOKEN_PERSONAL_DATA_MESSAGE =
  'Токену API заявки недоступны: в них персональные данные посетителей. Смотрите их в админке'

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
  'members.invite': 'Приглашать участников может только владелец',
  'leads.read': 'Заявки видят владелец и клиент сайта',
  'leads.manage': 'Обрабатывать заявки могут владелец и клиент сайта',
  'leads.settings': 'Настройки заявок меняют владелец и клиент сайта',
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
