import type { LeadSource } from '@averra/schema'
import { useSuspenseQuery } from '@tanstack/react-query'
import { startTransition, useState } from 'react'
import { pagePath } from '../pages-format'
import { leadSummaryQuery } from '../queries'
import { cardClassName } from '../ui/Card'
import { DataTable } from '../ui/DataTable'
import { Tabs } from '../ui/Tabs'
import styles from './LeadSummary.module.scss'

export function LeadSummary({ siteId }: { siteId: string }) {
  const [days, setDays] = useState<'7' | '30' | '90'>('30')
  const { data } = useSuspenseQuery(leadSummaryQuery(siteId, days))
  return (
    <LeadSummaryView
      data={data}
      days={days}
      onDaysChange={(next) => startTransition(() => setDays(next))}
    />
  )
}

type SummaryRow = { label: string; count: number }
export type LeadSummaryData = {
  total: number
  sources: SummaryRow[]
  pages: SummaryRow[]
  forms: (SummaryRow & { pageSlug: string; blockId: string; source: LeadSource })[]
}

export function LeadSummaryView({
  data,
  days,
  onDaysChange,
}: {
  data: LeadSummaryData
  days: '7' | '30' | '90'
  onDaysChange: (days: '7' | '30' | '90') => void
}) {
  return (
    <section aria-label="Сводка заявок" className={`${cardClassName()} ${styles.summary}`}>
      <h2>Сводка заявок</h2>
      <Tabs
        label="Период сводки"
        items={[
          { id: '7', label: '7 дней' },
          { id: '30', label: '30 дней' },
          { id: '90', label: '90 дней' },
        ]}
        value={days}
        onChange={onDaysChange}
        panelFocusable={data.total === 0}
      >
        <p>
          Заявок всего: <strong>{data.total}</strong>
        </p>
        <div className={data.total === 0 ? styles.emptyGroups : styles.groups}>
          <SummaryTable title="По источнику" rows={data.sources} />
          <SummaryTable title="По странице" rows={data.pages} />
          <SummaryTable
            title="По форме"
            rows={data.forms.map((row) => ({
              label: `${row.label}${row.source === 'footer' ? ' (подвал сайта)' : ''} · ${pagePath(row.pageSlug)} · ${row.blockId}`,
              count: row.count,
            }))}
          />
        </div>
        <p>Все статусы. Удалённые заявки и заявки старше срока хранения не учитываются.</p>
      </Tabs>
    </section>
  )
}

function SummaryTable({ title, rows }: { title: string; rows: SummaryRow[] }) {
  if (rows.length === 0) {
    return <p className={styles.empty}>{title}: заявок за этот период нет</p>
  }
  return (
    <DataTable
      caption={title}
      showCaption
      compact
      minWidth="0"
      rows={rows}
      rowKey={(row) => row.label}
      columns={[
        { key: 'label', header: 'Название', wrap: 'anywhere', cell: (row) => row.label },
        { key: 'count', header: 'Заявок', align: 'end', cell: (row) => row.count },
      ]}
    />
  )
}
