import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { signOut } from '../auth'
import { messageOf } from '../errors'
import { switchUser } from '../queries'
import styles from './ui.module.css'

type AppHeaderProps = { user: { name: string; email: string } }

/** Полоса над любым экраном админки: кто вошёл и «Выйти» */
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
