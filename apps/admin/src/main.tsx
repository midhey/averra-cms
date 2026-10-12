import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import { ApiRequestError } from './errors'
import { createAdminRouter } from './router'
import { setupZodMessages } from './zod-messages'

setupZodMessages()

const queryClient = new QueryClient({
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
