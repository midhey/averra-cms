import { NO_SITE_ACCESS_CODE } from '@averra/schema'
import { type ErrorComponentProps, Link } from '@tanstack/react-router'
import { ApiRequestError, messageOf, screenErrorOf } from '../errors'
import { useLogout } from '../shell/use-logout'
import { Button, buttonClassName, Spinner } from '../ui/Button'
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
    К обзору сайта
  </Link>
)

/**
 * Нет доступа к сайту установки (участник другого сайта старой базы): обзор ответил бы той же
 * ошибкой, поэтому вместо «К обзору сайта» — выйти и войти под другим пользователем
 */
const isNoSiteAccess = (error: unknown) =>
  error instanceof ApiRequestError && error.code === NO_SITE_ACCESS_CODE

/** Не загрузился сайт или страница (или экран сломался): что случилось и куда вернуться */
export function ErrorScreen({ error }: Pick<ErrorComponentProps, 'error'>) {
  usePageTitle('Ошибка')
  return (
    <Screen narrow>
      <PageHeader title="Не получилось открыть" />
      <InlineAlert tone="danger">{screenErrorOf(error)}</InlineAlert>
      {isNoSiteAccess(error) ? <LogoutAction /> : <div>{backHome}</div>}
    </Screen>
  )
}

function LogoutAction() {
  const logout = useLogout()
  return (
    <>
      {logout.isError && (
        <InlineAlert tone="danger">Не вышло выйти: {messageOf(logout.error)}</InlineAlert>
      )}
      <div>
        <Button loading={logout.isPending} onClick={() => logout.mutate()}>
          Выйти
        </Button>
      </div>
    </>
  )
}

/**
 * Нет такого адреса в админке — или адрес есть, но страницы или заявки с таким адресом нет.
 * Что именно не нашлось, маршрут передаёт в notFound({ data })
 */
export function NotFoundScreen({ data }: { data?: unknown }) {
  const heading = typeof data === 'string' ? data : 'Такой страницы в админке нет'
  usePageTitle(heading)
  return (
    <main className={styles.notFound}>
      <EmptyState title={heading} icon="search" headingLevel={1} action={backHome}>
        Проверьте адрес или вернитесь к обзору сайта.
      </EmptyState>
    </main>
  )
}
