// Что показывать роли на сайте. Решает всё равно API (таблица разрешений в
// apps/api/src/auth/access.ts), а здесь — только чтобы не предлагать того, что он не разрешит

export type SiteAccess = 'owner' | 'editor' | 'client'

/** Создавать, публиковать и удалять страницы могут владелец и редактор, клиент — только править */
export const canPublish = (access: SiteAccess) => access !== 'client'
export const canManagePages = (access: SiteAccess) => access !== 'client'
/** Картинки загружают все, кто правит сайт, а удаляют, как и страницы, владелец и редактор */
export const canDeleteMedia = (access: SiteAccess) => access !== 'client'

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
 * и клиент сайта (это его заявки). Редактору, который делает контент, они не нужны
 */
export const canSeeLeads = (access: SiteAccess) => access !== 'editor'

/** Приглашать участников и отзывать приглашения может только владелец */
export const canInvite = (access: SiteAccess) => access === 'owner'

/**
 * Раздел «SEO» — только владелец: индексация, адрес, редиректы и счётчики решает студия, которая
 * ведёт установку (apps/api/src/auth/access.ts, site.settings)
 */
export const canEditSeo = (access: SiteAccess) => access === 'owner'

/** Выгрузить все данные сайта (в них заявки) — тем же, кто видит заявки: владелец и клиент */
export const canExportData = (access: SiteAccess) => access !== 'editor'
