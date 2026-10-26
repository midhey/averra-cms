import {
  canEditHeader,
  canEditSeo,
  canEditTheme,
  canSeeLeads,
  canSeeNotifications,
  type SiteAccess,
} from '../permissions'
import type { IconName } from '../ui/Icon'

// Что боковая панель показывает роли. Решает всё равно API (apps/api/src/auth/access.ts):
// скрытый пункт — удобство, а не защита

export type SiteSectionId =
  | 'overview'
  | 'pages'
  | 'theme'
  | 'header'
  | 'media'
  | 'leads'
  | 'notifications'
  | 'seo'
  | 'settings'

export type SiteSection = {
  id: SiteSectionId
  label: string
  icon: IconName
  /** Счётчик новых заявок */
  badge?: number
}

/**
 * Разделы сайта установки. «Заявки» — только тем, кому API отдаёт их число: владелец и клиент
 * (у редактора и токена newLeads — null), «Уведомления» — им же. «Тема» — владельцу и редактору
 * (клиент тему не меняет), «Шапка и подвал» — им же, «SEO и аналитика» — только владельцу
 */
export function siteSections(site: { access: SiteAccess; newLeads: number | null }): SiteSection[] {
  const sections: SiteSection[] = [
    { id: 'overview', label: 'Обзор', icon: 'overview' },
    { id: 'pages', label: 'Страницы', icon: 'pages' },
  ]
  if (canEditTheme(site.access)) sections.push({ id: 'theme', label: 'Тема', icon: 'palette' })
  if (canEditHeader(site.access)) {
    sections.push({ id: 'header', label: 'Шапка и подвал', icon: 'header' })
  }
  sections.push({ id: 'media', label: 'Медиатека', icon: 'media' })
  if (canSeeLeads(site.access) && site.newLeads !== null) {
    sections.push({ id: 'leads', label: 'Заявки', icon: 'leads', badge: site.newLeads })
  }
  if (canSeeNotifications(site.access)) {
    sections.push({ id: 'notifications', label: 'Уведомления', icon: 'bell' })
  }
  if (canEditSeo(site.access))
    sections.push({ id: 'seo', label: 'SEO и аналитика', icon: 'search' })
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
