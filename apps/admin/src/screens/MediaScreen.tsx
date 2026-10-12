import { useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { useId } from 'react'
import { MediaLibrary } from '../media/MediaLibrary'
import { canDeleteMedia } from '../permissions'
import { siteQuery } from '../queries'
import { Breadcrumbs } from '../ui/Breadcrumbs'
import styles from './screens.module.css'

const route = getRouteApi('/sites/$siteId/media')

/** Медиатека сайта: загрузка, превью и удаление картинок, которые нигде не стоят */
export function MediaScreen() {
  const { siteId } = route.useParams()
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const headingId = useId()

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <Breadcrumbs site={site} current="Медиатека" />
        <h1 id={headingId}>Медиатека</h1>
      </header>
      <section className={styles.section} aria-labelledby={headingId}>
        <MediaLibrary siteId={siteId} canDelete={canDeleteMedia(site.access)} />
      </section>
    </main>
  )
}
