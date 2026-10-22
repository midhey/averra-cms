import { ExistingPageSlug, LeadStatus, Uuid } from '@averra/schema'
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { legacySiteTarget } from './legacy-paths'
import { canInvite, canManageChannels, canSeeLeads, safeRedirect } from './permissions'
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
  notificationOutboxQuery,
  notificationsQuery,
  pageQuery,
  pagesQuery,
  passwordResetQuery,
  recentLeadsQuery,
  siteIdOf,
  siteNotificationsQuery,
  siteQuery,
  siteSettingsQuery,
  statusQuery,
} from './queries'
import { CookiesScreen } from './screens/CookiesScreen'
import { EditorScreen } from './screens/EditorScreen'
import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen'
import { InstallationScreen } from './screens/InstallationScreen'
import { InviteScreen } from './screens/InviteScreen'
import { LeadError, LeadNotFound, LeadScreen, NoLeadSelected } from './screens/LeadScreen'
import { LeadsScreen } from './screens/LeadsScreen'
import { LoginScreen } from './screens/LoginScreen'
import { MailScreen } from './screens/MailScreen'
import { MediaScreen } from './screens/MediaScreen'
import { NotificationsScreen } from './screens/NotificationsScreen'
import { OverviewScreen } from './screens/OverviewScreen'
import { PagesScreen } from './screens/PagesScreen'
import { ResetPasswordScreen } from './screens/ResetPasswordScreen'
import { SeoScreen } from './screens/SeoScreen'
import { SiteSettingsScreen } from './screens/SiteSettingsScreen'
import { ErrorScreen, NotFoundScreen, PendingScreen } from './screens/StatusScreens'
import { AdminLayout } from './shell/AdminLayout'

// Маршруты описаны в коде, без генератора: всё дерево видно здесь.
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
 * Данных API она не берёт, поэтому открывается без входа и со своей оболочкой
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
  component: Outlet,
  notFoundComponent: NotFoundScreen,
})

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
 * Старые адреса /sites/<id>/… — на те же экраны без id: одна установка — один сайт, а закладки
 * и ссылки из старых писем должны работать (legacy-paths.ts). Без входа корень сначала ведёт
 * на вход, а после него человек вернётся сюда и попадёт на новый адрес
 */
const legacySitesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sites/$',
  beforeLoad: ({ location }) => {
    const target = legacySiteTarget(location.pathname, location.searchStr, location.hash)
    throw redirect({ href: target ?? '/', replace: true })
  },
})

/**
 * Кривой адрес страницы в ссылке — это «не найдено», а не «данные не прошли проверку» от API.
 * Проверяем той же схемой, что API: страницы со старыми адресами открываются
 */
function checkSlug(slug: string) {
  if (!ExistingPageSlug.safeParse(slug).success) throw notFound({ data: 'Страница не найдена' })
}

/**
 * Оболочка закрытых экранов: боковая панель и экран (AdminLayout). Её загрузчик берёт то, что
 * панель показывает сразу: кто вошёл, сайт установки (название, домен) и роль на нём (разделы,
 * счётчик заявок). Их сбой (участник без доступа к сайту) не прячет оболочку (allSettled): экран
 * покажет ошибку своим загрузчиком, а «Выйти» в панели останется. Почта и состояние установки —
 * только владельцу и второстепенные. Редактор в оболочку не входит: у него своя раскладка
 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_app',
  loader: async ({ context: { queryClient } }) => {
    const me = await queryClient.ensureQueryData(meQuery())
    await Promise.all([
      Promise.allSettled([
        siteIdOf(queryClient).then((siteId) => queryClient.ensureQueryData(siteQuery(siteId))),
      ]),
      me?.role === 'owner' &&
        Promise.allSettled([
          queryClient.ensureQueryData(mailQuery()),
          queryClient.ensureQueryData(statusQuery()),
        ]),
    ])
  },
  component: AdminLayout,
})

/** Сайт установки и роль на нём: от роли зависит, что ещё грузить экрану */
const loadSite = async (queryClient: QueryClient) => {
  const siteId = await siteIdOf(queryClient)
  return { siteId, site: await queryClient.ensureQueryData(siteQuery(siteId)) }
}

// Обзор сайта — первый экран админки: состояние публикации и сборки, карточки, страницы и
// последние заявки. Сборка и заявки — второстепенное: их сбой виден в своей карточке (allSettled)
const overviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  loader: async ({ context: { queryClient } }) => {
    const siteId = await siteIdOf(queryClient)
    const [site] = await Promise.all([
      queryClient.ensureQueryData(siteQuery(siteId)),
      queryClient.ensureQueryData(pagesQuery(siteId)),
      Promise.allSettled([queryClient.ensureQueryData(buildQuery(siteId))]),
    ])
    if (canSeeLeads(site.access) && site.newLeads !== null) {
      await Promise.allSettled([queryClient.ensureQueryData(recentLeadsQuery(siteId))])
    }
  },
  component: OverviewScreen,
})

const pagesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/pages',
  loader: async ({ context: { queryClient } }) => {
    const { siteId } = await loadSite(queryClient)
    await queryClient.ensureQueryData(pagesQuery(siteId))
  },
  component: PagesScreen,
})

const mediaRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/media',
  loader: async ({ context: { queryClient } }) => {
    const { siteId } = await loadSite(queryClient)
    await queryClient.ensureQueryData(mediaQuery(siteId))
  },
  component: MediaScreen,
})

// Заявки — владельцу и клиенту сайта. Редактору API ответит 403, и экран ошибки скажет почему.
// Список — родитель, карточка заявки — ребёнок: при переходе между заявками и вкладками список
// не пересоздаётся, и фокус остаётся там, где был
const leadsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/leads',
  // ?status=new | processed — вкладка списка; без него — все заявки
  validateSearch: (search: Record<string, unknown>): { status?: LeadStatus } => {
    const status = LeadStatus.safeParse(search.status)
    return status.success ? { status: status.data } : {}
  },
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ context: { queryClient }, deps: { status } }) => {
    const { siteId } = await loadSite(queryClient)
    await Promise.all([
      queryClient.ensureQueryData(leadsQuery(siteId, status)),
      queryClient.ensureQueryData(leadSettingsQuery(siteId)),
      // Заголовки страниц — подписать, откуда заявка («Главная · форма «Замер»»)
      queryClient.ensureQueryData(pagesQuery(siteId)),
    ])
  },
  component: LeadsScreen,
})

const leadsIndexRoute = createRoute({
  getParentRoute: () => leadsRoute,
  path: '/',
  component: NoLeadSelected,
})

const leadRoute = createRoute({
  getParentRoute: () => leadsRoute,
  path: '$leadId',
  beforeLoad: ({ params }) => {
    if (!Uuid().safeParse(params.leadId).success) throw notFound({ data: 'Заявка не найдена' })
  },
  loader: async ({ context: { queryClient }, params: { leadId } }) =>
    queryClient.ensureQueryData(leadQuery(await siteIdOf(queryClient), leadId)),
  component: LeadScreen,
  // Ошибка заявки — внутри колонки карточки, список рядом остаётся
  errorComponent: LeadError,
  notFoundComponent: LeadNotFound,
})

// Уведомления: получатели заявок (владелец и клиент) — главное содержимое, их сбой — экран ошибки.
// Грузятся у любой роли, как заявки: редактору, открывшему адрес напрямую, API ответит 403, и
// экран ошибки скажет почему, а не покажет пустой экран с одним заголовком. Каналы и служебные
// события — владельцу. Последние сообщения — второстепенное (allSettled)
const notificationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/notifications',
  loader: async ({ context: { queryClient } }) => {
    const { siteId, site } = await loadSite(queryClient)
    await Promise.all([
      queryClient.ensureQueryData(siteNotificationsQuery(siteId)),
      canManageChannels(site.access) && queryClient.ensureQueryData(notificationsQuery()),
      canManageChannels(site.access) &&
        Promise.allSettled([queryClient.ensureQueryData(notificationOutboxQuery())]),
    ])
  },
  component: NotificationsScreen,
})

// Настройки сайта: заявки (владелец и клиент), участники (владелец), сайт на сервере, выгрузка.
// Настройки заявок — главное содержимое своего раздела: их сбой — экран ошибки. Остальное —
// второстепенное (allSettled): сбой показывается внутри своего раздела
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  loader: async ({ context: { queryClient } }) => {
    const { siteId, site } = await loadSite(queryClient)
    await Promise.all([
      canSeeLeads(site.access) && queryClient.ensureQueryData(leadSettingsQuery(siteId)),
      Promise.allSettled([queryClient.ensureQueryData(buildQuery(siteId))]),
      canInvite(site.access) &&
        Promise.allSettled([
          queryClient.ensureQueryData(invitationsQuery(siteId)),
          queryClient.ensureQueryData(mailQuery()),
        ]),
    ])
  },
  component: SiteSettingsScreen,
})

// SEO и настройки сайта — только владельцу: участнику API ответит 403, и экран ошибки скажет
// почему. Медиатека — для выбора иконки и картинок, страницы — для карточки «Страница 404»
const seoRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/seo',
  loader: async ({ context: { queryClient } }) => {
    const siteId = await siteIdOf(queryClient)
    await Promise.all([
      queryClient.ensureQueryData(siteSettingsQuery(siteId)),
      queryClient.ensureQueryData(pagesQuery(siteId)),
      queryClient.ensureQueryData(mediaQuery(siteId)),
    ])
  },
  component: SeoScreen,
})

// «SEO и аналитика» → «Cookie и согласие»: тоже только владельцу. Страницы — для выбора страницы
// политики и шаблонов документов, сайт — тема для предпросмотра
const cookiesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/seo/cookies',
  loader: async ({ context: { queryClient } }) => {
    const siteId = await siteIdOf(queryClient)
    await Promise.all([
      queryClient.ensureQueryData(siteSettingsQuery(siteId)),
      queryClient.ensureQueryData(pagesQuery(siteId)),
      queryClient.ensureQueryData(siteQuery(siteId)),
    ])
  },
  component: CookiesScreen,
})

// Почта — только владельцу: участнику API ответит 403, и экран ошибки скажет почему
const mailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/mail',
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(mailQuery()),
      queryClient.ensureQueryData(mailSmtpQuery()),
      queryClient.ensureQueryData(mailOutboxQuery()),
    ]),
  component: MailScreen,
})

// Состояние установки — только владельцу. Здесь оно главное содержимое: сбой — экран ошибки.
// Всегда свежее: в панели оно могло загрузиться давно
const statusRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/status',
  loader: ({ context: { queryClient } }) => queryClient.fetchQuery(statusQuery()),
  component: InstallationScreen,
})

// Редактор — вне оболочки: в концепте у него своя полноэкранная раскладка
const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pages/$slug',
  beforeLoad: ({ params }) => checkSlug(params.slug),
  // Страница — всегда свежая из API, не из кеша: редактор берёт её в своё состояние один раз,
  // и устаревший черновик (например, после правки через MCP) при сохранении затёр бы новый
  loader: async ({ context: { queryClient }, params: { slug } }) => {
    const siteId = await siteIdOf(queryClient)
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
  legacySitesRoute,
  appRoute.addChildren([
    overviewRoute,
    pagesRoute,
    mediaRoute,
    leadsRoute.addChildren([leadsIndexRoute, leadRoute]),
    notificationsRoute,
    seoRoute,
    cookiesRoute,
    settingsRoute,
    mailRoute,
    statusRoute,
  ]),
  editorRoute,
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
