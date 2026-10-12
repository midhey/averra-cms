import { type QueryClient, useQuery } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { safeRedirect } from './permissions'
import { meQuery, pageQuery, pagesQuery, siteQuery, sitesQuery } from './queries'
import { EditorScreen } from './screens/EditorScreen'
import { LoginScreen } from './screens/LoginScreen'
import { SiteScreen } from './screens/SiteScreen'
import { SitesScreen } from './screens/SitesScreen'
import { ErrorScreen, NotFoundScreen, PendingScreen } from './screens/StatusScreens'
import { AppHeader } from './ui/AppHeader'

// Маршруты описаны в коде, без генератора: экранов четыре, всё дерево видно здесь.
// Данные загружаются в кеш TanStack Query, роутер только ждёт их перед показом экрана

type RouterContext = { queryClient: QueryClient }

const LOGIN_PATH = '/login'

const rootRoute = createRootRouteWithContext<RouterContext>()({
  // Вся админка, кроме входа, — только после входа. Кто вошёл, спрашиваем у API один раз
  // и держим в кеше; любой 401 потом сбрасывает это и ведёт на вход (main.tsx)
  beforeLoad: async ({ context: { queryClient }, location }) => {
    if (location.pathname === LOGIN_PATH) return
    const me = await queryClient.ensureQueryData(meQuery())
    if (!me) throw redirect({ to: LOGIN_PATH, search: { redirect: location.href } })
  },
  component: RootLayout,
  notFoundComponent: NotFoundScreen,
})

function RootLayout() {
  const { data: me } = useQuery(meQuery())
  return (
    <div className="admin">
      {me && <AppHeader user={me} />}
      <Outlet />
    </div>
  )
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LOGIN_PATH,
  // Куда вернуть после входа. Проверяет safeRedirect: только адрес внутри админки
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: search.redirect } : {},
  // Уже вошёл (например, открыл /login из истории) — сразу туда, куда шёл
  beforeLoad: async ({ context: { queryClient }, search }) => {
    if (await queryClient.ensureQueryData(meQuery())) {
      throw redirect({ href: safeRedirect(search.redirect), replace: true })
    }
  },
  component: LoginScreen,
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

const routeTree = rootRoute.addChildren([loginRoute, sitesRoute, siteRoute, editorRoute])

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
