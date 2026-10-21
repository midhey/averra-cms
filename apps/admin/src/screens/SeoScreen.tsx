import { useSuspenseQuery } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'
import { siteSettingsQuery } from '../queries'
import { NotFoundSection } from '../seo/NotFoundSection'
import { RedirectsSection } from '../seo/RedirectsSection'
import {
  AnalyticsSection,
  GeneralSection,
  IconSection,
  IndexingSection,
  OrganizationSection,
  VerificationSection,
} from '../seo/SeoSections'
import { UnsavedChangesGuard } from '../seo/unsaved'
import { PageHeader } from '../ui/PageHeader'
import { Screen } from '../ui/Screen'
import { StatusPill } from '../ui/StatusPill'
import { usePageTitle } from '../ui/use-page-title'
import { useSiteId } from '../use-site'

/**
 * Раздел «SEO» — всё, что влияет на поиск, соцсети и аналитику сайта целиком: одно место, а не
 * поля по разным экранам. Только владелец (видимость — в панели, решает всё равно API). Каждая
 * карточка сохраняет свои поля, сохранение пересобирает сайт. Несохранённое в карточке помечено,
 * а уход с экрана с ним — с вопросом
 */
export function SeoScreen() {
  const siteId = useSiteId()
  const { data: view } = useSuspenseQuery(siteSettingsQuery(siteId))
  const { hash } = useLocation()
  usePageTitle('SEO', view.settings.name)

  // Пришли по ссылке с обзора (#indexing) — к своей карточке, когда карточки уже на экране
  useEffect(() => {
    if (hash) document.getElementById(hash)?.scrollIntoView()
  }, [hash])

  const props = { siteId, view }
  return (
    <Screen narrow>
      <PageHeader
        eyebrow={view.settings.name}
        title="SEO"
        meta={
          view.settings.hideFromSearch ? (
            <StatusPill tone="warning" appearance="dot">
              Сайт скрыт от поисковиков
            </StatusPill>
          ) : (
            <StatusPill tone="success" appearance="dot">
              Сайт открыт поисковикам
            </StatusPill>
          )
        }
      />
      <UnsavedChangesGuard>
        <GeneralSection {...props} />
        <IndexingSection {...props} />
        <IconSection {...props} />
        <VerificationSection {...props} />
        <AnalyticsSection {...props} />
        <OrganizationSection {...props} />
        <RedirectsSection {...props} />
      </UnsavedChangesGuard>
      <NotFoundSection siteId={siteId} />
    </Screen>
  )
}
