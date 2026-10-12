import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { pageQuery, pagesQuery, siteQuery, sitesQuery } from './queries'
import { EditorScreen } from './screens/EditorScreen'
import { SiteScreen } from './screens/SiteScreen'
import { SitesScreen } from './screens/SitesScreen'
import { ErrorScreen, NotFoundScreen, PendingScreen } from './screens/StatusScreens'

// Маршруты описаны в коде, без генератора: экранов три, всё дерево видно здесь.
// Данные загружаются в кеш TanStack Query, роутер только ждёт их перед показом экрана

type RouterContext = { queryClient: QueryClient }

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <div className="admin">
      <Outlet />
    </div>
  ),
  notFoundComponent: NotFoundScreen,
})

const sitesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(sitesQuery()),
  component: SitesScreen,
})

const siteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sites/$siteId',
  loader: ({ context: { queryClient }, params: { siteId } }) =>
    Promise.all([
      queryClient.ensureQueryData(siteQuery(siteId)),
      queryClient.ensureQueryData(pagesQuery(siteId)),
    ]),
  component: SiteScreen,
})

const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sites/$siteId/pages/$slug',
  // Страница — всегда свежая из API, не из кеша: редактор берёт её в своё состояние один раз,
  // и устаревший черновик (например, после правки через MCP) при сохранении затёр бы новый
  loader: async ({ context: { queryClient }, params: { siteId, slug } }) => {
    const [site, page] = await Promise.all([
      queryClient.ensureQueryData(siteQuery(siteId)),
      queryClient.fetchQuery(pageQuery(siteId, slug)),
    ])
    return { site, page }
  },
  // Без этого роутер при повторном заходе сначала показал бы прошлые данные, а свежие
  // загрузил бы фоном — а редактор их уже не подхватит
  gcTime: 0,
  component: EditorScreen,
})

const routeTree = rootRoute.addChildren([sitesRoute, siteRoute, editorRoute])

export function createAdminRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPendingComponent: PendingScreen,
    defaultErrorComponent: ErrorScreen,
    // Свежесть данных решает TanStack Query: роутер зовёт загрузчик на каждый переход,
    // а ensureQueryData сама берёт кеш или идёт в API
    defaultPreloadStaleTime: 0,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAdminRouter>
  }
}
