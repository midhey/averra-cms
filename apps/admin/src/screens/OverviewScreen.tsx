import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../api'
import { messageOf } from '../errors'
import { pluralRu } from '../format/plural'
import { type LeadField, leadName, leadPreview, leadSource } from '../leads/lead-format'
import { type PageRow, PagesTable, RelativeTime } from '../pages/PagesTable'
import { PublishOutcome } from '../pages/PublishOutcome'
import { publishPages, publishQuestion } from '../pages/publish-all'
import { filterPages, pagesSummary, pagesWithChanges } from '../pages-format'
import { canManagePages, canPublish, canSeeLeads } from '../permissions'
import { buildSummary, failedBuildOutcome } from '../publish/build-format'
import { useBuild } from '../publish/use-build'
import { leadsQuery, meQuery, pagesQuery, queryKeys, siteQuery, statusQuery } from '../queries'
import { Button, buttonClassName } from '../ui/Button'
import { cardClassName } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { TextInput } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { mutedClassName, Screen, Section } from '../ui/Screen'
import { StatusPill } from '../ui/StatusPill'
import { usePageTitle } from '../ui/use-page-title'
import styles from './OverviewScreen.module.scss'

const route = getRouteApi('/_app/sites/$siteId')

/** Обзор сайта по концепту: что опубликовано и собрано, карточки, страницы, последние заявки */
export function OverviewScreen() {
  const { siteId } = route.useParams()
  // Другой сайт — другой экран: сообщения одного сайта не переезжают на другой по «Назад»
  return <Overview key={siteId} siteId={siteId} />
}

function Overview({ siteId }: { siteId: string }) {
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { data: pages } = useSuspenseQuery(pagesQuery(siteId))
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  usePageTitle(site.name, 'обзор')

  const changed = pagesWithChanges(pages)
  const lastPublished = pages
    .map((page) => page.publishedAt)
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1)

  const publishAll = useMutation({
    mutationFn: (targets: readonly PageRow[]) =>
      publishPages(targets, (slug) =>
        api.sites[':siteId'].pages[':slug'].publish.$post({ param: { siteId, slug } }),
      ),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.pages(siteId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.build(siteId) }),
      ]),
  })

  // Несколько страниц уходят на публичный сайт одним нажатием: сначала спрашиваем, какие
  function confirmPublish() {
    if (window.confirm(publishQuestion(changed))) publishAll.mutate(changed)
  }

  const managePages = canManagePages(site.access)
  const shown = filterPages(pages, search)

  return (
    <Screen>
      <PageHeader
        title={site.name}
        meta={
          <>
            {lastPublished ? (
              <StatusPill tone="success" appearance="dot">
                Опубликован <RelativeTime iso={lastPublished} />
              </StatusPill>
            ) : (
              <StatusPill tone="neutral" appearance="dot">
                Ещё не опубликован
              </StatusPill>
            )}
            {changed.length > 0 && (
              <StatusPill tone="warning" appearance="dot">
                Неопубликованные правки на {changed.length}{' '}
                {pluralRu(changed.length, ['странице', 'страницах', 'страницах'])}
              </StatusPill>
            )}
            <BuildMeta siteId={siteId} />
          </>
        }
        actions={
          <>
            {managePages && (
              <Link
                to="/sites/$siteId/pages"
                params={{ siteId }}
                hash="new-page"
                className={buttonClassName()}
              >
                <Icon name="plus" />
                Новая страница
              </Link>
            )}
            {canPublish(site.access) && changed.length > 0 && (
              <Button variant="primary" loading={publishAll.isPending} onClick={confirmPublish}>
                Опубликовать правки
              </Button>
            )}
          </>
        }
      />

      <PublishOutcome result={publishAll.data} error={publishAll.error} />

      <BuildFailure siteId={siteId} />

      <section aria-label="Коротко" className={styles.stats}>
        {canSeeLeads(site.access) && site.newLeads !== null && (
          <Link
            to="/sites/$siteId/leads"
            params={{ siteId }}
            search={{ status: 'new' }}
            className={cardClassName({ interactive: true })}
          >
            <span className={styles.statLabel}>Новые заявки</span>
            <span className={styles.statFigure}>{site.newLeads}</span>
            <span className={styles.statLink}>
              Разобрать <Icon name="arrow-right" size={16} />
            </span>
          </Link>
        )}
        <div className={cardClassName()}>
          <span className={styles.statLabel}>Страницы</span>
          <span className={styles.statFigure}>{pages.length}</span>
          <span className={styles.statNote}>{pagesSummary(pages)}</span>
        </div>
        <BuildCard siteId={siteId} />
        <BackupCard />
      </section>

      <Section
        title="Страницы"
        actions={
          <TextInput
            label="Найти страницу"
            hideLabel
            type="search"
            placeholder="Найти страницу"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={styles.search}
          />
        }
      >
        <PagesTable
          siteId={siteId}
          pages={shown}
          empty={
            <EmptyState title="Ничего не нашлось" icon="search" headingLevel={3}>
              Нет страниц, в заголовке или адресе которых есть «{search.trim()}».
            </EmptyState>
          }
        />
      </Section>

      {canSeeLeads(site.access) && site.newLeads !== null && <RecentLeads siteId={siteId} />}
    </Screen>
  )
}

/** Состояние сборки в строке сведений: только если сайт собирается на этом сервере */
function BuildMeta({ siteId }: { siteId: string }) {
  const { data } = useBuild(siteId)
  if (!data?.enabled || !data.latest) return null
  const summary = buildSummary(data.latest)
  return (
    <StatusPill tone={summary.tone} appearance="dot">
      Сборка: {summary.label.toLowerCase()}
    </StatusPill>
  )
}

/** Упавшая сборка — заметно и с причиной в «Настройках сайта» */
function BuildFailure({ siteId }: { siteId: string }) {
  const { data } = useBuild(siteId)
  if (!data?.enabled || data.latest?.status !== 'failed') return null
  return (
    <InlineAlert
      tone="danger"
      title="Последняя сборка упала"
      action={
        <Link
          to="/sites/$siteId/settings"
          params={{ siteId }}
          hash="build"
          className={buttonClassName({ size: 'small' })}
        >
          Подробнее
        </Link>
      }
    >
      {failedBuildOutcome(Boolean(data.live?.finishedAt))}
    </InlineAlert>
  )
}

function BuildCard({ siteId }: { siteId: string }) {
  const build = useBuild(siteId)
  // Сборка — второстепенное: её сбой виден в своей карточке с «Повторить», экран остаётся
  if (build.isError && !build.data) {
    return (
      <div className={cardClassName()}>
        <span className={styles.statLabel}>Последняя сборка</span>
        <span className={styles.statValue}>Не загрузилась</span>
        <span className={styles.statNote}>{messageOf(build.error)}</span>
        <div>
          <Button size="small" loading={build.isFetching} onClick={() => void build.refetch()}>
            Повторить
          </Button>
        </div>
      </div>
    )
  }
  const { data } = build
  if (!data?.enabled || !data.latest) return null
  const summary = buildSummary(data.latest)
  return (
    <div className={cardClassName()}>
      <span className={styles.statLabel}>Последняя сборка</span>
      <span className={styles.statValue}>{summary.label}</span>
      <span className={styles.statNote}>
        <RelativeTime iso={summary.at} />
      </span>
    </div>
  )
}

/** Бэкап — только владельцу (состояние установки) и только там, где бэкапы ведутся */
function BackupCard() {
  const { data: me } = useQuery(meQuery())
  const status = useQuery({
    ...statusQuery(),
    enabled: me?.role === 'owner',
    retryOnMount: false,
  })
  const last = status.data?.backup.enabled ? status.data.backup.last : null
  if (!last) return null
  return (
    <div className={cardClassName()}>
      <span className={styles.statLabel}>Бэкап</span>
      <span className={styles.statValue}>{last.ok ? 'Сделан' : 'Не удался'}</span>
      <span className={styles.statNote}>
        <RelativeTime iso={last.finishedAt} />
        {last.ok && last.verified && ', проверен восстановлением'}
      </span>
    </div>
  )
}

function RecentLeads({ siteId }: { siteId: string }) {
  const leads = useQuery({ ...leadsQuery(siteId), retryOnMount: false })
  const { data: pages } = useSuspenseQuery(pagesQuery(siteId))
  const pageTitles = new Map(pages.map((page) => [page.slug, page.title]))
  const recent = leads.data?.items.slice(0, 3) ?? []
  return (
    <Section
      title="Последние заявки"
      actions={
        <Link to="/sites/$siteId/leads" params={{ siteId }} className={styles.sectionLink}>
          Все заявки
        </Link>
      }
    >
      {leads.isError ? (
        <p className={mutedClassName}>
          Не удалось загрузить заявки: {messageOf(leads.error)}.{' '}
          <Button size="small" onClick={() => leads.refetch()}>
            Повторить
          </Button>
        </p>
      ) : recent.length === 0 ? (
        <div className={cardClassName()}>
          <EmptyState title="Заявок пока нет" icon="leads" headingLevel={3}>
            Они придут с форм на сайте — здесь и письмом.
          </EmptyState>
        </div>
      ) : (
        <ul className={styles.leads}>
          {recent.map((lead) => {
            const fields = lead.data as LeadField[]
            return (
              <li key={lead.id}>
                <Link
                  to="/sites/$siteId/leads/$leadId"
                  params={{ siteId, leadId: lead.id }}
                  className={cardClassName({ padding: 'compact', interactive: true })}
                >
                  <span className={styles.leadMeta}>
                    <span>{leadSource(lead, pageTitles.get(lead.pageSlug))}</span>
                    <RelativeTime iso={lead.createdAt} />
                  </span>
                  <span className={styles.leadName}>
                    {lead.status === 'new' && <span className="visually-hidden">Новая: </span>}
                    {leadName(fields)}
                  </span>
                  <span className={styles.leadPreview}>{leadPreview(fields)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
