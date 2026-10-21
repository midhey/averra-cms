import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { relativeTime } from '../format/time'
import { formatDateTime, pagePath, pageState } from '../pages-format'
import { type Column, DataTable } from '../ui/DataTable'
import { StatusPill } from '../ui/StatusPill'

export type PageRow = {
  slug: string
  title: string
  updatedAt: string
  publishedAt: string | null
  hasUnpublishedChanges: boolean
}

type PagesTableProps = {
  pages: readonly PageRow[]
  /** Колонка действий («Удалить»): только тем, кто управляет страницами */
  actions?: (page: PageRow) => ReactNode
  /** Что показать, когда поиск ничего не нашёл */
  empty?: ReactNode
}

/** Время «15 минут назад», а точное — в подсказке и в dateTime для диктора и машин */
export function RelativeTime({ iso }: { iso: string }) {
  const exact = formatDateTime(iso)
  return (
    <time dateTime={iso} title={exact}>
      {relativeTime(iso)}
    </time>
  )
}

/**
 * Таблица страниц сайта, как в концепте: страница (ссылка в редактор), адрес, состояние
 * и когда менялась. Подпись «Страницы» — по ней таблицу находит диктор (и e2e)
 */
export function PagesTable({ pages, actions, empty }: PagesTableProps) {
  const columns: Column<PageRow>[] = [
    {
      key: 'title',
      header: 'Страница',
      wrap: 'anywhere',
      cell: (page) => (
        <Link to="/pages/$slug" params={{ slug: page.slug }}>
          {page.title}
        </Link>
      ),
    },
    {
      key: 'slug',
      header: 'Адрес',
      mono: true,
      muted: true,
      wrap: 'anywhere',
      cell: (page) => pagePath(page.slug),
    },
    {
      key: 'state',
      header: 'Состояние',
      wrap: 'nowrap',
      cell: (page) => {
        const state = pageState(page)
        if (page.publishedAt === null)
          return <StatusPill tone={state.tone}>{state.label}</StatusPill>
        // Когда страница вышла на сайт: в подсказке плашки и скрытым текстом для диктора.
        // Колонку «Опубликована» концепт заменил на «Изменена», а дата публикации нужна
        const when = formatDateTime(page.publishedAt)
        return (
          <span title={`Опубликована ${when}`}>
            <StatusPill tone={state.tone}>{state.label}</StatusPill>
            <span className="visually-hidden">
              , опубликована <time dateTime={page.publishedAt}>{when}</time>
            </span>
          </span>
        )
      },
    },
    {
      key: 'updated',
      header: 'Изменена',
      muted: true,
      wrap: 'nowrap',
      cell: (page) => <RelativeTime iso={page.updatedAt} />,
    },
  ]
  if (actions) {
    columns.push({
      key: 'actions',
      header: <span className="visually-hidden">Действия</span>,
      align: 'end',
      wrap: 'nowrap',
      cell: actions,
    })
  }
  return (
    <DataTable
      caption="Страницы"
      columns={columns}
      rows={pages}
      rowKey={(page) => page.slug}
      empty={empty}
    />
  )
}
