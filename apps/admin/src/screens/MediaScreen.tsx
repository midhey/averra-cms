import { useSuspenseQuery } from '@tanstack/react-query'
import { countRu } from '../format/plural'
import { MediaLibrary } from '../media/MediaLibrary'
import { canDeleteMedia } from '../permissions'
import { mediaQuery, siteQuery } from '../queries'
import { PageHeader } from '../ui/PageHeader'
import { Screen } from '../ui/Screen'
import { usePageTitle } from '../ui/use-page-title'
import { useSiteId } from '../use-site'

/** Медиатека сайта: загрузка, превью и удаление картинок, которые нигде не стоят */
export function MediaScreen() {
  return <SiteMedia siteId={useSiteId()} />
}

function SiteMedia({ siteId }: { siteId: string }) {
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { data: media } = useSuspenseQuery(mediaQuery(siteId))
  usePageTitle('Медиатека', site.name)

  return (
    <Screen>
      <PageHeader
        eyebrow={site.name}
        title="Медиатека"
        meta={countRu(media.items.length, ['картинка', 'картинки', 'картинок'])}
      />
      <MediaLibrary siteId={siteId} canDelete={canDeleteMedia(site.access)} />
    </Screen>
  )
}
