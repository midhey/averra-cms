import { type ErrorComponentProps, Link } from '@tanstack/react-router'
import { screenErrorOf } from '../errors'
import { buttonClassName, Spinner } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { Screen } from '../ui/Screen'
import { usePageTitle } from '../ui/use-page-title'
import styles from './StatusScreens.module.scss'

/** Пока маршрут грузит данные: спокойная строка со спиннером (без движения при reduced-motion) */
export function PendingScreen() {
  return (
    <p className={styles.pending} role="status">
      <Spinner />
      Загружаю…
    </p>
  )
}

const backHome = (
  <Link to="/" className={buttonClassName()}>
    К списку сайтов
  </Link>
)

/** Не загрузился сайт или страница (или экран сломался): что случилось и куда вернуться */
export function ErrorScreen({ error }: ErrorComponentProps) {
  usePageTitle('Ошибка')
  return (
    <Screen narrow>
      <PageHeader title="Не получилось открыть" />
      <InlineAlert tone="danger">{screenErrorOf(error)}</InlineAlert>
      <div>{backHome}</div>
    </Screen>
  )
}

/**
 * Нет такого адреса в админке — или адрес есть, но сайта или страницы с таким id нет.
 * Что именно не нашлось, маршрут передаёт в notFound({ data })
 */
export function NotFoundScreen({ data }: { data?: unknown }) {
  const heading = typeof data === 'string' ? data : 'Такой страницы в админке нет'
  usePageTitle(heading)
  return (
    <main className={styles.notFound}>
      <EmptyState title={heading} icon="search" headingLevel={1} action={backHome}>
        Проверьте адрес или вернитесь к списку сайтов.
      </EmptyState>
    </main>
  )
}
