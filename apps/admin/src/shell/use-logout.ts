import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { signOut } from '../auth'
import { switchUser } from '../queries'

/** «Выйти»: сессия завершается, кеш прошлого пользователя сбрасывается, дальше — экран входа */
export function useLogout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      await switchUser(queryClient, false)
      await navigate({ to: '/login', search: {} })
    },
  })
}
