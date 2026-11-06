// Что показывать роли на сайте. Решает всё равно API (таблица разрешений в
// apps/api/src/auth/access.ts), а здесь — только чтобы не предлагать того, что он не разрешит.
// Таблица ниже повторяет её строка в строку: поменяли там — поменяйте здесь (permissions.test.ts)

import type { SiteRoleKey } from '@averra/schema'

/** Роль на сайте: владелец установки, администратор сайта (client) или редактор */
export type SiteAccess = SiteRoleKey

const everyone: readonly SiteAccess[] = ['owner', 'client', 'editor']
const ownerAndAdmin: readonly SiteAccess[] = ['owner', 'client']
const ownerOnly: readonly SiteAccess[] = ['owner']

/** Действия API, от которых зависят экраны, и кому они открыты */
export const siteRights = {
  'page.publish': everyone,
  'page.manage': everyone,
  'media.delete': everyone,
  'members.invite': ownerAndAdmin,
  'leads.read': ownerAndAdmin,
  'site.export': ownerAndAdmin,
  'site.settings': ownerAndAdmin,
  'header.edit': ownerAndAdmin,
  'header.look': ownerOnly,
  'theme.edit': ownerOnly,
  'blocks.define': ownerOnly,
  'channels.manage': ownerOnly,
} as const satisfies Record<string, readonly SiteAccess[]>

const allowed = (right: keyof typeof siteRights) => (access: SiteAccess) =>
  (siteRights[right] as readonly SiteAccess[]).includes(access)

/** Создавать, публиковать и удалять страницы — все, кто работает с сайтом */
export const canPublish = allowed('page.publish')
export const canManagePages = allowed('page.manage')
/** Картинки загружают и удаляют все, кто работает с сайтом */
export const canDeleteMedia = allowed('media.delete')

/**
 * Куда вернуть после входа. Только адрес внутри админки: ссылка вида /login?redirect=https://…
 * не должна уводить на чужой сайт. Всё остальное — на обзор сайта
 */
export function safeRedirect(target: unknown) {
  if (typeof target !== 'string' || !target.startsWith('/')) return '/'
  const base = 'http://admin.invalid'
  let url: URL
  try {
    url = new URL(target, base)
  } catch {
    return '/'
  }
  // //evil.example и /\evil.example браузер считает адресом другого сайта
  if (url.origin !== base) return '/'
  if (url.pathname === '/login') return '/'
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Заявки с форм — персональные данные посетителей: их видят, обрабатывают и настраивают владелец
 * и администратор сайта (это его заявки). Редактору, который пишет контент, они не нужны
 */
export const canSeeLeads = allowed('leads.read')

/**
 * Раздел «Уведомления»: получателей уведомлений о заявках меняют владелец и администратор сайта
 * (как настройки заявок), а каналы, бота Telegram и служебные события — только владелец
 */
export const canSeeNotifications = canSeeLeads
export const canManageChannels = allowed('channels.manage')

/**
 * Участники: владелец и администратор сайта. Администратор сайта приглашает и отключает только
 * редакторов (assignableRoles)
 */
export const canInvite = allowed('members.invite')

/** Какие роли выдаёт роль — как assignableRoles в apps/api/src/auth/access.ts */
export const assignableRoles: Record<SiteAccess, readonly SiteAccess[]> = {
  owner: ['owner', 'client', 'editor'],
  client: ['editor'],
  editor: [],
}

/**
 * Можно ли вошедшему менять участника с этой ролью. У отключённого (role — null) решает роль до
 * отключения: администратор сайта возвращает только бывших редакторов, неизвестную — владелец
 */
export const canManageMember = (
  access: SiteAccess,
  role: SiteAccess | null,
  disabledRole: SiteAccess | null = null,
) => {
  const effective = role ?? disabledRole
  return effective === null ? access === 'owner' : assignableRoles[access].includes(effective)
}

/**
 * Раздел «SEO»: индексация, адрес, счётчики, «Организация» (контакты и реквизиты) — владелец и
 * администратор сайта (site.settings)
 */
export const canEditSeo = allowed('site.settings')

/**
 * Тема сайта (экран «Тема») — только владелец: фирменный стиль делает студия, одна правка меняет
 * весь сайт (theme.edit). Остальные видят её только для чтения
 */
export const canEditTheme = allowed('theme.edit')

/** Шапка, меню и подвал — владелец и администратор сайта: его контакты и навигация (header.edit) */
export const canEditHeader = allowed('header.edit')
/**
 * Вид шапки и подвала (раскладка, поведение, линия, кнопка, меню на телефоне, фон подвала) —
 * только владелец, как тема (header.look). Администратор сайта видит его только для чтения
 */
export const canEditHeaderLook = allowed('header.look')

/** Выгрузить все данные сайта (в них заявки) — тем же, кто видит заявки */
export const canExportData = allowed('site.export')

/**
 * Свои блоки (раздел «Свои блоки»): поля, шаблон и CSS — код на страницах сайта, его пишет
 * разработчик студии, владелец установки (blocks.define). Остальные только заполняют
 * опубликованные свои блоки на страницах
 */
export const canDefineBlocks = allowed('blocks.define')
