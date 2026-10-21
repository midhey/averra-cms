import type { SiteSettings } from '@averra/schema'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { pagesQuery } from '../queries'
import { RedirectRows } from './RedirectRows'
import { SettingsCard } from './SettingsCard'
import {
  emptyRedirectRow,
  type RedirectRow,
  redirectRows,
  rowsToRedirects,
  sentIndexes,
  shadowingPage,
} from './seo-format'
import { type SettingsView, useSettingsForm } from './use-settings-form'

/**
 * Редиректы 301: переезд со старого сайта или смена адреса страницы. Срабатывают на адресах, где
 * страницы нет: существующая страница главнее (сервер отдаёт её, а не спрашивает таблицу)
 */
export function RedirectsSection({ siteId, view }: { siteId: string; view: SettingsView }) {
  const [rows, setRows] = useState<RedirectRow[]>(() => redirectRows(view.settings.redirects))
  const { data: pages } = useSuspenseQuery(pagesQuery(siteId))
  // Страницу по адресу «откуда» могли создать уже после редиректа: сервер отдаёт её, и редирект
  // молча перестаёт работать. Сказать об этом может только экран
  const warning = (row: RedirectRow) => {
    const page = shadowingPage(row.from, pages)
    return page
      ? `По этому адресу есть страница «${page.title}»: редирект не сработает. Удалите строку или страницу`
      : undefined
  }
  const form = useSettingsForm({
    siteId,
    patch: { redirects: rowsToRedirects(rows) },
    done: 'Редиректы сохранены. Они действуют сразу',
    onSaved: (settings: SiteSettings) => setRows(redirectRows(settings.redirects)),
  })
  const indexes = sentIndexes(rows)
  // Строка, которая уйдёт в API, — под своим номером в таблице API; пустая — под своим ключом
  const names = (row: RedirectRow, index: number) => {
    const sent = indexes[index]
    const base = sent === undefined ? `redirect-${row.key}` : `redirects.${sent}`
    return { from: `${base}.from`, to: `${base}.to` }
  }

  return (
    <SettingsCard
      id="redirects"
      title="Редиректы"
      description="Постоянное перенаправление (301) со старого адреса на новый: поисковик перенесёт его позиции, а посетитель по старой ссылке попадёт куда нужно. Срабатывает только там, где страницы нет."
      form={form}
      saveLabel="Сохранить редиректы"
    >
      <RedirectRows
        rows={rows}
        names={names}
        error={form.error}
        warning={warning}
        onChange={(key, part, value) => {
          const index = rows.findIndex((row) => row.key === key)
          setRows((current) =>
            current.map((row) => (row.key === key ? { ...row, [part]: value } : row)),
          )
          const row = rows[index]
          if (row) form.clear(names(row, index)[part])
        }}
        onRemove={(key) => setRows((current) => current.filter((row) => row.key !== key))}
        onAdd={() => setRows((current) => [...current, emptyRedirectRow()])}
      />
    </SettingsCard>
  )
}
