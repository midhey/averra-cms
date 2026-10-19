import { setupZodMessages } from '@averra/schema'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiRequestError } from './errors'
import { queryKeys } from './queries'
import { createAdminRouter } from './router'
import globalCss from './styles/global.scss?inline'
import { installGlobalStyle } from './styles/global-style'

setupZodMessages()
installGlobalStyle(document, globalCss)

/**
 * 401 из любого запроса или мутации — сессия кончилась или её отозвали. Ведём на вход
 * и запоминаем, где был человек. Несохранённые правки редактора защищает его же вопрос
 * перед уходом: отказавшись, можно остаться и скопировать текст
 */
function onApiError(error: unknown) {
  if (!(error instanceof ApiRequestError) || error.status !== 401) return
  queryClient.setQueryData(queryKeys.me, null)
  const { pathname, href } = router.state.location
  if (pathname === '/login') return
  void router.navigate({ to: '/login', search: { redirect: href } })
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      // Ответ API 4xx повтором не исправить (сайта нет — его и не будет): сразу показываем
      // ошибку. Сетевой сбой и 5xx повторяем пару раз
      retry: (failures, error) =>
        !(error instanceof ApiRequestError && error.status < 500) && failures < 2,
    },
  },
})
const router = createAdminRouter(queryClient)

const root = document.getElementById('root')
if (!root) throw new Error('Не найден элемент #root')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
