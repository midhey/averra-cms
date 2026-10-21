import { canSeeLeads, type SiteAccess } from '../permissions'
import type { IconName } from '../ui/Icon'

// Что боковая панель показывает роли. Решает всё равно API (apps/api/src/auth/access.ts):
// скрытый пункт — удобство, а не защита

export type SiteSectionId = 'overview' | 'pages' | 'media' | 'leads' | 'settings'

export type SiteSection = {
  id: SiteSectionId
  label: string
  icon: IconName
  /** Счётчик новых заявок */
  badge?: number
}

/**
 * Разделы сайта установки. «Заявки» — только тем, кому API отдаёт их число: владелец и клиент
 * (у редактора и токена newLeads — null)
 */
export function siteSections(site: { access: SiteAccess; newLeads: number | null }): SiteSection[] {
  const sections: SiteSection[] = [
    { id: 'overview', label: 'Обзор', icon: 'overview' },
    { id: 'pages', label: 'Страницы', icon: 'pages' },
    { id: 'media', label: 'Медиатека', icon: 'media' },
  ]
  if (canSeeLeads(site.access) && site.newLeads !== null) {
    sections.push({ id: 'leads', label: 'Заявки', icon: 'leads', badge: site.newLeads })
  }
  sections.push({ id: 'settings', label: 'Настройки сайта', icon: 'settings' })
  return sections
}

/** Почта и состояние установки — только у владельца установки */
export const seesInstallation = (role: 'owner' | 'member') => role === 'owner'

const siteRoleNames: Record<SiteAccess, string> = {
  owner: 'Владелец',
  editor: 'Редактор',
  client: 'Клиент',
}

/** Подпись роли под именем: владелец — всегда владелец, участник — его роль на сайте установки */
export function roleName(role: 'owner' | 'member', siteAccess?: SiteAccess) {
  if (role === 'owner') return 'Владелец'
  return siteAccess ? siteRoleNames[siteAccess] : 'Участник'
}
