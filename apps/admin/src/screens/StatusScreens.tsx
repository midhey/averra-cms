import { type ErrorComponentProps, Link } from '@tanstack/react-router'
import { messageOf } from '../errors'
import styles from './screens.module.css'

export function PendingScreen() {
  return (
    <p className={styles.message} role="status">
      Загружаю…
    </p>
  )
}

/** Не загрузился сайт или страница: что случилось и куда вернуться */
export function ErrorScreen({ error }: ErrorComponentProps) {
  return (
    <main className={styles.screen}>
      <h1>Не получилось открыть</h1>
      <p role="alert" className={styles.formError}>
        {messageOf(error)}
      </p>
      <p>
        <Link to="/">К списку сайтов</Link>
      </p>
    </main>
  )
}

export function NotFoundScreen() {
  return (
    <main className={styles.screen}>
      <h1>Такой страницы в админке нет</h1>
      <p>
        <Link to="/">К списку сайтов</Link>
      </p>
    </main>
  )
}
