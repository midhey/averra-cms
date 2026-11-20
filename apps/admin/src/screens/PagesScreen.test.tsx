// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { queryKeys } from '../queries'
import { ConfirmProvider } from '../ui/Confirm'
import { OverviewScreen } from './OverviewScreen'
import { PagesScreen } from './PagesScreen'

const siteId = '00000000-0000-4000-8000-000000000001'

const site = {
  id: siteId,
  name: 'Тестовый сайт',
  access: 'editor',
  hiddenFromSearch: false,
  setup: null,
  newLeads: null,
}

async function renderScreen(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(queryKeys.currentSite, {
    id: siteId,
    name: site.name,
    url: null,
    otherSites: 0,
  })
  queryClient.setQueryData(queryKeys.site(siteId), site)
  queryClient.setQueryData(queryKeys.pages(siteId), [])
  queryClient.setQueryData(queryKeys.build(siteId), { enabled: false, latest: null })
  queryClient.setQueryData(queryKeys.me, { role: 'member' })

  const rootRoute = createRootRoute({ component: () => <>{ui}</> })
  const anyRoute = createRoute({ getParentRoute: () => rootRoute, path: '$' })
  const router = createRouter({
    routeTree: rootRoute.addChildren([anyRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('пустые списки страниц', () => {
  it('на экране страниц предлагает создать страницу без поиска', async () => {
    await renderScreen(<PagesScreen />)

    expect(screen.getByRole('heading', { name: 'Страниц пока нет' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Создать страницу' }).getAttribute('href')).toBe(
      '/pages#new-page',
    )
  })

  // Поиск без совпадений на «Обзоре» проверяет e2e (tests/overview.spec.ts): экран тянет данные сайта
})
