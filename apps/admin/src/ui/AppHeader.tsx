import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { signOut } from '../auth'
import { messageOf } from '../errors'
import { switchUser } from '../queries'
import styles from './ui.module.css'

type AppHeaderProps = { user: { name: string; email: string; role: 'owner' | 'member' } }

/** Полоса над любым экраном админки: кто вошёл, разделы владельца и «Выйти» */
export function AppHeader({ user }: AppHeaderProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      await switchUser(queryClient, false)
      await navigate({ to: '/login', search: {} })
    },
  })

  return (
    <header className={styles.appHeader}>
      <span className={styles.appName}>Averra CMS</span>
      {/* Почта общая для всех сайтов и только у владельца: участнику API её не покажет */}
      {user.role === 'owner' && (
        <nav aria-label="Разделы админки" className={styles.appNav}>
          <Link to="/mail" activeProps={{ 'aria-current': 'page' }}>
            Почта
          </Link>
        </nav>
      )}
      <span className={styles.user} title={user.email}>
        {user.name}
      </span>
      {logout.isError && (
        <span role="alert" className={styles.appError}>
          Не вышло выйти: {messageOf(logout.error)}
        </span>
      )}
      <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
        Выйти
      </button>
    </header>
  )
}
