import { ExistingPageSlug, LeadStatus, Uuid } from '@averra/schema'
import { type QueryClient, useQuery } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  Outlet,
  redirect,
  useLocation,
} from '@tanstack/react-router'
import { safeRedirect } from './permissions'
import {
  buildQuery,
  invitationsQuery,
  leadQuery,
  leadSettingsQuery,
  leadsQuery,
  mailOutboxQuery,
  mailQuery,
  mailSmtpQuery,
  mediaQuery,
  meQuery,
  pageQuery,
  pagesQuery,
  passwordResetQuery,
  siteQuery,
  sitesQuery,
  statusQuery,
} from './queries'
import { EditorScreen } from './screens/EditorScreen'
import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen'
import { InviteScreen } from './screens/InviteScreen'
import { LeadScreen } from './screens/LeadScreen'
import { LeadsScreen } from './screens/LeadsScreen'
import { LoginScreen } from './screens/LoginScreen'
import { MailScreen } from './screens/MailScreen'
import { MediaScreen } from './screens/MediaScreen'
import { ResetPasswordScreen } from './screens/ResetPasswordScreen'
import { SiteScreen } from './screens/SiteScreen'
import { SitesScreen } from './screens/SitesScreen'
import { ErrorScreen, NotFoundScreen, PendingScreen } from './screens/StatusScreens'
import { AppHeader } from './ui/AppHeader'

// Маршруты описаны в коде, без генератора: экранов одиннадцать, всё дерево видно здесь.
// Данные загружаются в кеш TanStack Query, роутер только ждёт их перед показом экрана

type RouterContext = { queryClient: QueryClient }

const LOGIN_PATH = '/login'

/**
 * Экраны без входа: вход, «Забыли пароль?», новый пароль и приглашение по ссылке из письма.
 * У человека по ссылке входа ещё нет (или он его забыл)
 */
const PUBLIC_PATHS = new Set([LOGIN_PATH, '/forgot-password', '/reset-password', '/invite'])

/**
 * Витрина компонентов — только в разработке (`vite`, e2e): в `vite build` маршрута и кода нет.
 * Данных API она не берёт, поэтому открывается без входа и без шапки старых экранов
 */
const DEV_UI_PATH = '/dev/ui'
if (import.meta.env.DEV) PUBLIC_PATHS.add(DEV_UI_PATH)

const rootRoute = createRootRouteWithContext<RouterContext>()({
  // Вся админка, кроме входа, — только после входа. Кто вошёл, спрашиваем у API один раз
  // и держим в кеше; любой 401 потом сбрасывает это и ведёт на вход (main.tsx)
  beforeLoad: async ({ context: { queryClient }, location }) => {
    if (PUBLIC_PATHS.has(location.pathname)) return
    const me = await queryClient.ensureQueryData(meQuery())
    if (!me) throw redirect({ to: LOGIN_PATH, search: { redirect: location.href } })
  },
  component: RootLayout,
  notFoundComponent: NotFoundScreen,
})

function RootLayout() {
  const { data: me } = useQuery(meQuery())
  const { pathname } = useLocation()
  return (
    <div className="admin">
      {me && !(import.meta.env.DEV && pathname === DEV_UI_PATH) && <AppHeader user={me} />}
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

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(passwordResetQuery()),
  component: ForgotPasswordScreen,
})

// Токен в обоих — во фрагменте адреса (#token=…): его читает сам экран
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: ResetPasswordScreen,
})

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite',
  component: InviteScreen,
})

/**
 * Кривой id сайта или адрес страницы в ссылке — это «не найдено», а не «данные не прошли
 * проверку» от API. Проверяем теми же схемами, что API: страницы со старыми адресами открываются
 */
function checkSiteId(siteId: string) {
  if (!Uuid().safeParse(siteId).success) throw notFound({ data: 'Сайт не найден' })
}

function checkSlug(slug: string) {
  if (!ExistingPageSlug.safeParse(slug).success) throw notFound({ data: 'Страница не найдена' })
}

const sitesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  loader: async ({ context: { queryClient } }) => {
    // Состояние установки — только владельцу и второстепенное: его сбой показывает свой блок,
    // а не прячет список сайтов за экраном ошибки (allSettled)
    const me = await queryClient.ensureQueryData(meQuery())
    await Promise.all([
      queryClient.ensureQueryData(sitesQuery()),
      me?.role === 'owner' && Promise.allSettled([queryClient.ensureQueryData(statusQuery())]),
    ])
  },
  component: SitesScreen,
})

const siteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sites/$siteId',
  beforeLoad: ({ params }) => checkSiteId(params.siteId),
  loader: async ({ context: { queryClient }, params: { siteId } }) => {
    // Приглашения и состояние почты — только владельцу (остальным API ответит 403). Владелец
    // админки — владелец на любом сайте, поэтому решаем по тому, кто вошёл, и грузим всё сразу.
    // Они второстепенные: их сбой не должен прятать страницы сайта за экраном ошибки. Поэтому
    // allSettled: ошибка остаётся в кеше запроса, и раздел «Участники» показывает её у себя.
    // 401 и так уводит на вход (обработчик кеша в main.tsx)
    const me = await queryClient.ensureQueryData(meQuery())
    await Promise.all([
      queryClient.ensureQueryData(siteQuery(siteId)),
      queryClient.ensureQueryData(pagesQuery(siteId)),
      // Сборка сайта на сервере — тоже второстепенное: её сбой показывает свой раздел
      Promise.allSettled([queryClient.ensureQueryData(buildQuery(siteId))]),
      me?.role === 'owner' &&
        Promise.allSettled([
          queryClient.ensureQueryData(invitationsQuery(siteId)),
          queryClient.ensureQueryData(mailQuery()),
        ]),
    ])
  },
  component: SiteScreen,
})

const mediaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sites/$siteId/media',
  beforeLoad: ({ params }) => checkSiteId(params.siteId),
  loader: ({ context: { queryClient }, params: { siteId } }) =>
    Promise.all([
      queryClient.ensureQueryData(siteQuery(siteId)),
      queryClient.ensureQueryData(mediaQuery(siteId)),
    ]),
  component: MediaScreen,
})

// Заявки — владельцу и клиенту сайта. Редактору API ответит 403, и экран ошибки скажет почему
const leadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sites/$siteId/leads',
  // ?status=new | processed — фильтр списка; остальное — все заявки
  validateSearch: (search: Record<string, unknown>): { status?: LeadStatus } => {
    const status = LeadStatus.safeParse(search.status)
    return status.success ? { status: status.data } : {}
  },
  beforeLoad: ({ params }) => checkSiteId(params.siteId),
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: ({ context: { queryClient }, params: { siteId }, deps: { status } }) =>
    Promise.all([
      queryClient.ensureQueryData(siteQuery(siteId)),
      queryClient.ensureQueryData(leadsQuery(siteId, status)),
      queryClient.ensureQueryData(leadSettingsQuery(siteId)),
    ]),
  component: LeadsScreen,
})

const leadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sites/$siteId/leads/$leadId',
  beforeLoad: ({ params }) => {
    checkSiteId(params.siteId)
    if (!Uuid().safeParse(params.leadId).success) throw notFound({ data: 'Заявка не найдена' })
  },
  loader: ({ context: { queryClient }, params: { siteId, leadId } }) =>
    Promise.all([
      queryClient.ensureQueryData(siteQuery(siteId)),
      queryClient.ensureQueryData(leadQuery(siteId, leadId)),
    ]),
  component: LeadScreen,
})

const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sites/$siteId/pages/$slug',
  beforeLoad: ({ params }) => {
    checkSiteId(params.siteId)
    checkSlug(params.slug)
  },
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

// Почта — только владельцу: участнику API ответит 403, и экран ошибки скажет почему
const mailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/mail',
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(mailQuery()),
      queryClient.ensureQueryData(mailSmtpQuery()),
      queryClient.ensureQueryData(mailOutboxQuery()),
    ]),
  component: MailScreen,
})

const devRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: DEV_UI_PATH,
        component: lazyRouteComponent(() => import('./dev/UiShowcase'), 'UiShowcase'),
      }),
    ]
  : []

const routeTree = rootRoute.addChildren([
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  inviteRoute,
  sitesRoute,
  siteRoute,
  mediaRoute,
  leadsRoute,
  leadRoute,
  editorRoute,
  mailRoute,
  ...devRoutes,
])

export function createAdminRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPendingComponent: PendingScreen,
    defaultErrorComponent: ErrorScreen,
    // Предзагрузки по наведению нет (defaultPreload не задан). Если её включат, пусть и она
    // не держит свой кеш: свежесть данных решает TanStack Query, ensureQueryData сама берёт
    // кеш или идёт в API. Загрузчик на каждом переходе роутер зовёт и так (staleTime: 0)
    defaultPreloadStaleTime: 0,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAdminRouter>
  }
}
