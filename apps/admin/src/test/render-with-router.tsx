import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

/**
 * Компонент со ссылками роутера и запросами — в роутере в памяти: корень рисует компонент на
 * любом адресе, чтобы Link строил настоящие href и ставил aria-current. Для тестов (happy-dom)
 */
export async function renderWithRouter(ui: ReactNode, path = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute({ component: () => <>{ui}</> })
  const anyRoute = createRoute({ getParentRoute: () => rootRoute, path: '$' })
  const router = createRouter({
    routeTree: rootRoute.addChildren([anyRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  const result = render(
    <QueryClientProvider client={queryClient}>
      {/* biome-ignore lint/suspicious/noExplicitAny: роутер теста не совпадает с типами Register админки */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  )
  return { ...result, router, queryClient }
}
