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

/**
 * Раздел «Уведомления»: получателей уведомлений о заявках меняют владелец и клиент (как настройки
 * заявок), а каналы, бота Telegram и служебные события — только владелец (сопровождение установки)
 */
export const canSeeNotifications = canSeeLeads
export const canManageChannels = (access: SiteAccess) => access === 'owner'

/** Приглашать участников и отзывать приглашения может только владелец */
export const canInvite = (access: SiteAccess) => access === 'owner'

/**
 * Раздел «SEO» — только владелец: индексация, адрес, редиректы и счётчики решает студия, которая
 * ведёт установку (apps/api/src/auth/access.ts, site.settings)
 */
export const canEditSeo = (access: SiteAccess) => access === 'owner'

/**
 * Тема сайта (экран «Тема»): меняют и публикуют те же, кто публикует страницы, — владелец и
 * редактор. Публикация темы пересобирает весь сайт (apps/api/src/auth/access.ts, theme.edit)
 */
export const canEditTheme = (access: SiteAccess) => access !== 'client'

/**
 * Шапка сайта и меню (экран «Шапка и подвал») — как тема: владелец и редактор, публикация
 * пересобирает весь сайт (apps/api/src/auth/access.ts, header.edit)
 */
export const canEditHeader = (access: SiteAccess) => access !== 'client'

/** Выгрузить все данные сайта (в них заявки) — тем же, кто видит заявки: владелец и клиент */
export const canExportData = (access: SiteAccess) => access !== 'editor'
