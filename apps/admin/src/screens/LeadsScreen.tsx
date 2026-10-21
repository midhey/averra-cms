import type { LeadStatus } from '@averra/schema'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi, Link, Outlet, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../api'
import { saveResponse } from '../download'
import { apiRequestError, messageOf } from '../errors'
import {
  type LeadField,
  leadName,
  leadPreview,
  leadSource,
  notificationsLine,
} from '../leads/lead-format'
import { RelativeTime } from '../pages/PagesTable'
import { leadSettingsQuery, leadsQuery, pagesQuery, siteQuery } from '../queries'
import { Button } from '../ui/Button'
import { cardClassName } from '../ui/Card'
import { cx } from '../ui/cx'
import { EmptyState } from '../ui/EmptyState'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { Screen } from '../ui/Screen'
import { Tabs } from '../ui/Tabs'
import { usePageTitle } from '../ui/use-page-title'
import { useSiteId } from '../use-site'
import styles from './LeadsScreen.module.scss'

const route = getRouteApi('/_app/leads')

const LEADS_LIST_HEADING_ID = 'leads-list-heading'
const LEADS_TABS_ID = 'leads-tabs'

/**
 * Заявку удалили — её карточки и кнопки больше нет. Фокус — на выбранную вкладку над списком:
 * видимое место, откуда список читается дальше (фокус не остаётся на body —
 * документация: Разработчику → Соглашения, «Админка»)
 */
export function focusLeadsList() {
  document
    .getElementById(LEADS_TABS_ID)
    ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    ?.focus()
}

type Filter = LeadStatus | 'all'
type Notice = { kind: 'done' | 'error'; text: string }

/** Заявки с форм сайта: вкладки, список и карточка выбранной заявки рядом (ребёнок маршрута) */
export function LeadsScreen() {
  return <SiteLeads siteId={useSiteId()} />
}

function SiteLeads({ siteId }: { siteId: string }) {
  const { status } = route.useSearch()
  const navigate = useNavigate()
  const { leadId } = useParams({ strict: false })
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { data } = useSuspenseQuery(leadsQuery(siteId, status))
  const { data: settings } = useSuspenseQuery(leadSettingsQuery(siteId))
  const { data: pages } = useSuspenseQuery(pagesQuery(siteId))
  const pageTitles = new Map(pages.map((page) => [page.slug, page.title]))
  const [notice, setNotice] = useState<Notice>()
  usePageTitle('Заявки', site.name)
  const { notifications, items } = data
  const selected = leadId !== undefined

  const download = useMutation({
    mutationFn: () => downloadCsv(siteId),
    onSuccess: () => setNotice({ kind: 'done', text: 'Файл CSV со всеми заявками скачан' }),
    onError: (error) =>
      setNotice({ kind: 'error', text: `Не удалось выгрузить заявки: ${messageOf(error)}` }),
  })

  const tabs = [
    { id: 'new', label: 'Новые', count: site.newLeads ?? undefined },
    { id: 'processed', label: 'Обработанные' },
    { id: 'all', label: 'Все' },
  ] as const satisfies ReadonlyArray<{ id: Filter; label: string; count?: number | undefined }>

  return (
    <Screen>
      <PageHeader
        eyebrow={site.name}
        title="Заявки"
        meta={
          <>
            <span>{notificationsLine(settings, notifications.enabled)}</span>
            <Link to="/settings" hash="leads">
              Настроить
            </Link>
          </>
        }
        actions={
          <Button icon="download" loading={download.isPending} onClick={() => download.mutate()}>
            Скачать CSV
          </Button>
        }
      />

      {!notifications.enabled && (
        <InlineAlert tone="warning" title="Уведомления о заявках не уходят">
          {notifications.reason} Заявки сохраняются здесь — заглядывайте в раздел сами.
        </InlineAlert>
      )}
      {notice?.kind === 'done' && (
        <InlineAlert tone="success" live>
          {notice.text}
        </InlineAlert>
      )}
      {notice?.kind === 'error' && <InlineAlert tone="danger">{notice.text}</InlineAlert>}

      <div id={LEADS_TABS_ID} className={cx(styles.layout, selected && styles.cardOpen)}>
        <Tabs
          label="Фильтр заявок"
          items={tabs}
          value={status ?? 'all'}
          onChange={(next: Filter) =>
            navigate({
              to: '/leads',
              search: next === 'all' ? {} : { status: next },
            })
          }
          // Пустой список — в панели нечего фокусировать, и по WAI-ARIA сама панель — остановка Tab
          panelFocusable={items.length === 0}
        >
          <div className={styles.columns}>
            <div className={styles.listColumn}>
              <h2 id={LEADS_LIST_HEADING_ID} className="visually-hidden">
                Список заявок
              </h2>
              {items.length === 0 ? (
                <div className={cardClassName()}>
                  <EmptyState
                    title={status === undefined ? 'Заявок пока нет' : 'Таких заявок нет'}
                    icon="leads"
                    headingLevel={3}
                  >
                    {status === undefined
                      ? 'Они придут с форм на сайте — здесь и письмом.'
                      : 'Загляните на соседнюю вкладку.'}
                  </EmptyState>
                </div>
              ) : (
                <ul className={styles.list} aria-labelledby={LEADS_LIST_HEADING_ID}>
                  {items.map((lead) => {
                    const fields = lead.data as LeadField[]
                    return (
                      <li key={lead.id}>
                        <Link
                          to="/leads/$leadId"
                          params={{ leadId: lead.id }}
                          search={status ? { status } : {}}
                          className={cardClassName({ padding: 'compact', interactive: true })}
                        >
                          <span className={styles.itemMeta}>
                            <span>{leadSource(lead, pageTitles.get(lead.pageSlug))}</span>
                            <RelativeTime iso={lead.createdAt} />
                          </span>
                          <span className={styles.itemName}>
                            {lead.status === 'new' && (
                              <>
                                <span className={styles.newDot} aria-hidden="true" />
                                <span className="visually-hidden">Новая: </span>
                              </>
                            )}
                            {leadName(fields)}
                          </span>
                          <span className={styles.itemPreview}>{leadPreview(fields)}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <div className={styles.cardColumn}>
              <Outlet />
            </div>
          </div>
        </Tabs>
      </div>
    </Screen>
  )
}

/** CSV — потоком из API, имя файла из ответа (saveResponse) */
async function downloadCsv(siteId: string) {
  const res = await api.sites[':siteId'].leads.export.$get({ param: { siteId } })
  if (res.status !== 200) throw await apiRequestError(res)
  await saveResponse(res, 'leads.csv')
}
