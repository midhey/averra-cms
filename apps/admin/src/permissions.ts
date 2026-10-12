// Что показывать роли на сайте. Решает всё равно API (таблица разрешений в
// apps/api/src/auth/access.ts), а здесь — только чтобы не предлагать того, что он не разрешит

export type SiteAccess = 'owner' | 'editor' | 'client'

/** Создавать, публиковать и удалять страницы могут владелец и редактор, клиент — только править */
export const canPublish = (access: SiteAccess) => access !== 'client'
export const canManagePages = (access: SiteAccess) => access !== 'client'

/**
 * Куда вернуть после входа. Только адрес внутри админки: ссылка вида /login?redirect=https://…
 * не должна уводить на чужой сайт. Всё остальное — на список сайтов
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
