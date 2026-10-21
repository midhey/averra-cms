import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, getRouteApi, Link } from '@tanstack/react-router'
import { screenErrorOf } from '../errors'
import { LeadCard } from '../leads/LeadCard'
import { leadQuery, pagesQuery, siteQuery } from '../queries'
import { buttonClassName } from '../ui/Button'
import { cardClassName } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { InlineAlert } from '../ui/InlineAlert'
import { usePageTitle } from '../ui/use-page-title'
import { useSiteId } from '../use-site'
import { focusLeadsList } from './LeadsScreen'
import styles from './LeadsScreen.module.scss'

const route = getRouteApi('/_app/leads/$leadId')

/** Карточка выбранной заявки рядом со списком (на телефоне — вместо него) */
export function LeadScreen() {
  const siteId = useSiteId()
  const { leadId } = route.useParams()
  const { status } = route.useSearch()
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { data: lead } = useSuspenseQuery(leadQuery(siteId, leadId))
  const { data: pages } = useSuspenseQuery(pagesQuery(siteId))
  const pageTitle = pages.find((page) => page.slug === lead.pageSlug)?.title
  usePageTitle('Заявка', site.name)
  // key: другая заявка — другая карточка, сообщения прежней не переезжают на неё
  return (
    <LeadCard
      key={leadId}
      site={site}
      lead={lead}
      pageTitle={pageTitle}
      status={status}
      onDeleted={focusLeadsList}
    />
  )
}

/** Заявка не выбрана: на десктопе — подсказка рядом со списком, на телефоне её не видно */
export function NoLeadSelected() {
  return (
    <div className={`${cardClassName()} ${styles.placeholder}`}>
      <EmptyState title="Выберите заявку" icon="leads" headingLevel={2}>
        Её поля, согласие посетителя и действия откроются здесь.
      </EmptyState>
    </div>
  )
}

/** «Все заявки» с той же вкладкой: путь назад из карточки, которая не открылась */
function BackToLeads() {
  const { status } = route.useSearch()
  return (
    <Link to="/leads" search={status ? { status } : {}} className={buttonClassName()}>
      Все заявки
    </Link>
  )
}

/**
 * Заявка не загрузилась (удалена, сбой API): сообщение в колонке карточки, а не экран ошибки —
 * без второго main и h1 внутри экрана заявок, заголовок вкладки остаётся «Заявки»
 */
export function LeadError({ error }: ErrorComponentProps) {
  return (
    <div className={`${cardClassName()} ${styles.placeholder}`}>
      <InlineAlert tone="danger" title="Заявка не открылась" action={<BackToLeads />}>
        {screenErrorOf(error)}
      </InlineAlert>
    </div>
  )
}

/** Адрес заявки с таким id не найден — так же в колонке карточки */
export function LeadNotFound() {
  return (
    <div className={`${cardClassName()} ${styles.placeholder}`}>
      <EmptyState title="Заявка не найдена" icon="search" headingLevel={2} action={<BackToLeads />}>
        Возможно, её удалили. Выберите другую в списке.
      </EmptyState>
    </div>
  )
}
