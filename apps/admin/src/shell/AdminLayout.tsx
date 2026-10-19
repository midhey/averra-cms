import { Uuid } from '@averra/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router'
import { signOut } from '../auth'
import { messageOf } from '../errors'
import { mailQuery, meQuery, siteQuery, sitesQuery, statusQuery, switchUser } from '../queries'
import {
  AppShell,
  NavLinkContent,
  NavList,
  navLinkClassName,
  SidebarSection,
  SidebarUser,
} from '../ui/AppShell'
import { IconButton } from '../ui/Button'
import { StatusPill } from '../ui/StatusPill'
import styles from './Shell.module.scss'
import { SiteSwitcher } from './SiteSwitcher'
import {
  roleName,
  type SiteSectionId,
  seesInstallation,
  siteSections,
  switcherExpandable,
} from './sidebar-model'

/**
 * Оболочка закрытых экранов (кроме редактора): боковая панель по концепту и экран справа.
 * Данные панели грузит загрузчик макета (router.tsx) и маршрут экрана — здесь они уже в кеше
 */
export function AdminLayout() {
  return (
    <AppShell sidebar={<AdminSidebar />}>
      <Outlet />
    </AppShell>
  )
}

const siteLinks = {
  overview: { to: '/sites/$siteId', exact: true },
  pages: { to: '/sites/$siteId/pages', exact: false },
  media: { to: '/sites/$siteId/media', exact: false },
  leads: { to: '/sites/$siteId/leads', exact: false },
  settings: { to: '/sites/$siteId/settings', exact: false },
} as const satisfies Record<SiteSectionId, { to: string; exact: boolean }>

function AdminSidebar() {
  const { data: me } = useQuery(meQuery())
  const { siteId } = useParams({ strict: false })
  // Кривой id в адресе — экран «Сайт не найден», а панель просто без сайта
  const validSiteId = siteId !== undefined && Uuid().safeParse(siteId).success ? siteId : undefined
  const site = useQuery({
    ...siteQuery(validSiteId ?? ''),
    enabled: validSiteId !== undefined,
    retryOnMount: false,
  })
  const sites = useQuery({ ...sitesQuery(), retryOnMount: false })
  if (!me) return null
  const current = validSiteId !== undefined ? site.data : undefined

  return (
    <>
      {current ? (
        <>
          <SiteSwitcher
            current={current}
            sites={sites.data ?? [current]}
            expandable={switcherExpandable(me.role, sites.data?.length ?? 1)}
          />
          <NavList label="Разделы сайта">
            {siteSections(current).map((section) => (
              <li key={section.id}>
                <Link
                  to={siteLinks[section.id].to}
                  params={{ siteId: current.id }}
                  activeOptions={{ exact: siteLinks[section.id].exact }}
                  className={navLinkClassName}
                >
                  <NavLinkContent
                    icon={section.icon}
                    label={section.label}
                    badge={
                      section.badge === undefined
                        ? undefined
                        : { value: section.badge, label: `новых: ${section.badge}` }
                    }
                  />
                </Link>
              </li>
            ))}
          </NavList>
        </>
      ) : (
        <NavList label="Разделы">
          <li>
            <Link to="/" activeOptions={{ exact: true }} className={navLinkClassName}>
              <NavLinkContent icon="overview" label="Все сайты" />
            </Link>
          </li>
        </NavList>
      )}

      <SidebarSection title={seesInstallation(me.role) ? 'Установка' : undefined} bottom>
        {seesInstallation(me.role) && <InstallationLinks />}
        <UserBlock name={me.name} roleName={roleName(me.role, current?.access)} />
      </SidebarSection>
    </>
  )
}

/** Почта и состояние установки: только у владельца, данные — загрузчик макета (allSettled) */
function InstallationLinks() {
  const mail = useQuery({ ...mailQuery(), retryOnMount: false })
  const status = useQuery({ ...statusQuery(), retryOnMount: false })
  const mailState = mail.data?.status.enabled
  return (
    <NavList label="Установка">
      <li>
        <Link to="/mail" className={navLinkClassName}>
          <NavLinkContent
            icon="mail"
            label="Почта"
            aside={
              mailState === undefined ? undefined : (
                <StatusPill tone={mailState ? 'success' : 'danger'} appearance="dot">
                  {mailState ? 'работает' : 'выключена'}
                </StatusPill>
              )
            }
          />
        </Link>
      </li>
      <li>
        <Link to="/status" className={navLinkClassName}>
          <NavLinkContent
            icon="status"
            label="Состояние"
            aside={status.data ? <VersionAside status={status.data} /> : undefined}
          />
        </Link>
      </li>
    </NavList>
  )
}

/** Версия установки; если что-то требует внимания — точкой «внимание» и словами для диктора */
function VersionAside({ status }: { status: { version: string; problems: readonly unknown[] } }) {
  const version = <span className={styles.version}>{status.version}</span>
  if (status.problems.length === 0) return version
  return (
    <StatusPill tone="warning" appearance="dot">
      {version}
      <span className="visually-hidden">, требует внимания</span>
    </StatusPill>
  )
}

function UserBlock({ name, roleName }: { name: string; roleName: string }) {
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
    <>
      <SidebarUser
        name={name}
        roleName={roleName}
        action={
          <IconButton
            label="Выйти"
            icon="logout"
            size="small"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          />
        }
      />
      {logout.isError && (
        <p role="alert" className={styles.sidebarError}>
          Не вышло выйти: {messageOf(logout.error)}
        </p>
      )}
    </>
  )
}
