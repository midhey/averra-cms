import { useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi, useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'
import { ExportSection } from '../export/ExportSection'
import { InvitationsSection } from '../invitations/InvitationsSection'
import { LeadSettingsSection } from '../leads/LeadSettingsSection'
import { canExportData, canInvite, canPublish, canSeeLeads } from '../permissions'
import { BuildSection } from '../publish/BuildSection'
import { siteQuery } from '../queries'
import { PageHeader } from '../ui/PageHeader'
import { Screen } from '../ui/Screen'
import { usePageTitle } from '../ui/use-page-title'

const route = getRouteApi('/_app/sites/$siteId/settings')

/**
 * Настройки сайта: заявки (владелец и клиент), участники (владелец), сайт на сервере и выгрузка.
 * Что роль не может, не показываем — решает всё равно API
 */
export function SiteSettingsScreen() {
  const { siteId } = route.useParams()
  // Формы и сообщения одного сайта не переезжают на другой по «Назад»
  return <SiteSettings key={siteId} siteId={siteId} />
}

function SiteSettings({ siteId }: { siteId: string }) {
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { hash } = useLocation()
  usePageTitle('Настройки', site.name)

  // Пришли по ссылке «Настроить» или «Подробнее» (#leads, #build) — к своему разделу: роутер
  // прокручивает к якорю до того, как разделы отрисовались, поэтому повторяем после показа
  useEffect(() => {
    if (hash) document.getElementById(hash)?.scrollIntoView()
  }, [hash])

  return (
    <Screen narrow>
      <PageHeader eyebrow={site.name} title="Настройки сайта" />
      {canSeeLeads(site.access) && <LeadSettingsSection id="leads" siteId={siteId} />}
      {canInvite(site.access) && <InvitationsSection id="members" siteId={siteId} />}
      <BuildSection id="build" siteId={siteId} canBuild={canPublish(site.access)} />
      <ExportSection id="export" siteId={siteId} canExportData={canExportData(site.access)} />
    </Screen>
  )
}
