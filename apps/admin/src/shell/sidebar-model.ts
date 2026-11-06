import { roleLabels } from '@averra/schema'
import {
  canDefineBlocks,
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
  | 'blocks'
  | 'script'
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
 * Разделы сайта установки. «Заявки» — только тем, кому API отдаёт их число: владелец и
 * администратор сайта (у редактора и токена newLeads — null), «Уведомления», «Шапка и подвал» и
 * «SEO и аналитика» — им же. «Тема», «Свои блоки» и «Скрипт сайта» — только владельцу. Редактору — страницы,
 * медиатека и настройки сайта
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
  if (canDefineBlocks(site.access)) {
    sections.push({ id: 'blocks', label: 'Свои блоки', icon: 'blocks' })
    sections.push({ id: 'script', label: 'Скрипт сайта', icon: 'script' })
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

/** Подпись роли под именем: владелец — всегда владелец, участник — его роль на сайте установки */
export function roleName(role: 'owner' | 'member', siteAccess?: SiteAccess) {
  if (role === 'owner') return 'Владелец'
  return siteAccess ? roleLabels[siteAccess] : 'Участник'
}
