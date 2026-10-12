import { type ErrorComponentProps, Link } from '@tanstack/react-router'
import { screenErrorOf } from '../errors'
import { usePageTitle } from '../ui/use-page-title'
import styles from './screens.module.css'

export function PendingScreen() {
  return (
    <p className={styles.message} role="status">
      Загружаю…
    </p>
  )
}

/** Не загрузился сайт или страница (или экран сломался): что случилось и куда вернуться */
export function ErrorScreen({ error }: ErrorComponentProps) {
  usePageTitle('Ошибка')
  return (
    <main className={styles.screen}>
      <h1>Не получилось открыть</h1>
      <p role="alert" className={styles.formError}>
        {screenErrorOf(error)}
      </p>
      <p>
        <Link to="/">К списку сайтов</Link>
      </p>
    </main>
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
    <main className={styles.screen}>
      <h1>{heading}</h1>
      <p>
        <Link to="/">К списку сайтов</Link>
      </p>
    </main>
  )
}
