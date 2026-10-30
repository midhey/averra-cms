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
  // Сколько хранить заявки, подтверждать ли посетителю и куда уходят уведомления о заявках
  // (адреса почты и чаты Telegram в разделе «Уведомления»): в уведомлениях — те же персональные
  // данные, и решает о них тот же, кто их видит. Служебные уведомления и каналы — только владелец
  'leads.settings': ['owner', 'client'],
  // Полный экспорт данных сайта (принцип 8 «клиент не заложник»): в нём заявки, поэтому — тем же,
  // кто видит заявки. Клиент забирает свои данные сам, без студии
  'site.export': ['owner', 'client'],
  // SEO и настройки сайта (раздел «SEO»): индексация, адрес, редиректы, счётчики, иконка. Одна
  // ошибка здесь выкидывает сайт из поиска, а отвечает за это студия, которая ведёт установку.
  // Клиент передаёт ей коды счётчиков; описание и noindex страницы он правит в самой странице
  'site.settings': ['owner'],
  // Тема сайта (экран «Тема»): цвета и шрифты на весь сайт сразу. Те же, кто публикует страницы:
  // публикация темы пересобирает весь сайт. Клиент публиковать не может — и тему не меняет
  'theme.edit': ['owner', 'editor'],
  // Шапка сайта, меню и подвал — как тема: одни на все страницы, публикация пересобирает весь
  // сайт. Решают те, кто публикует страницы; клиент публиковать не может — и их не меняет
  'header.edit': ['owner', 'editor'],
  // Свои блоки (раздел «Свои блоки»): поля, шаблон Liquid и CSS — это код, который выводится на
  // каждой странице с блоком. Пишет его разработчик студии, который ставит установку и владеет ею,
  // и он же отвечает за то, что блок не ломает сайт. Редактор и клиент только заполняют свои блоки
  // на страницах (page.edit) и видят опубликованные определения (site.read). Токену API — нет
  // (tokenDenied): читать опубликованные он может, а менять — по отдельному праву токена
  'blocks.define': ['owner'],
  // Обновить установку до новой версии кнопкой в «Состоянии установки» (POST /api/status/update).
  // Действие не с сайтом, а с сервером: обновление останавливает админку и приём заявок, меняет код
  // всей установки и, если не встанет, откатывает базу из бэкапа. За сервер отвечает студия —
  // владелец установки. Редактор и клиент о сервере не решают, токену API — никогда (tokenDenied).
  // Проверяет его requireInstallation, а не requireSite: в адресе нет сайта
  'installation.update': ['owner'],
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
  'site.export',
])

export const TOKEN_PERSONAL_DATA_MESSAGE =
  'Токену API заявки недоступны: в них персональные данные посетителей. Смотрите их в админке'

/**
 * Действия, в которых токену API отказано при любой таблице выше, кроме персональных данных. Тема:
 * она одна на весь сайт, нейронка не видит, как выглядит результат, а проверка контраста не
 * ловит «некрасиво». Читать тему токену можно (GET /api/sites/:siteId/theme, MCP get_theme).
 * Шапка, меню и подвал — так же (читать: GET /api/sites/:siteId/header и …/footer, MCP get_header)
 */
export const tokenDenied: Partial<Record<Permission, string>> = {
  'theme.edit': 'Тему сайта меняют в админке: токену API она доступна только для чтения',
  // Шапка — на каждой странице, меню — навигация всего сайта: нейронка не видит, как шапка ляжет
  // на телефоне, а ошибка в ней видна на каждой странице
  'header.edit':
    'Шапку, меню и подвал сайта меняют в админке: токену API они доступны только для чтения',
  // Нейронка не решает, когда остановить сервер ради новой версии: это решение человека
  'installation.update': 'Обновлять установку токену API нельзя: это делает владелец в админке',
  // Блок — код на каждой странице с ним. Нейронка через MCP читает опубликованные определения
  // (list_blocks), а менять их сможет только по отдельному праву токена, которого пока нет
  'blocks.define':
    'Свои блоки токену API доступны только для чтения: определения меняет владелец в админке',
}

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
  'site.export': 'Выгрузить все данные сайта могут владелец и клиент: в них заявки',
  'site.settings': 'Настройки SEO сайта меняет владелец',
  'theme.edit': 'Тему сайта меняет владелец или редактор',
  'header.edit': 'Шапку, меню и подвал сайта меняет владелец или редактор',
  'blocks.define': 'Свои блоки создаёт и меняет только владелец установки',
  'installation.update': 'Обновить установку может только владелец',
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

/**
 * Роли на установке для действия без сайта в адресе (installation.*): владелец установки — owner,
 * участник — его роли на сайтах установки, токен — editor (как на своём сайте)
 */
export async function installationRolesOf(db: Db, actor: Actor): Promise<SiteRole[]> {
  if (actor.kind === 'token') return ['editor']
  if (actor.user.role === 'owner') return ['owner']
  const rows = await db
    .select({ role: siteMembers.role })
    .from(siteMembers)
    .where(eq(siteMembers.userId, actor.user.id))
  return rows.map((row) => row.role)
}
