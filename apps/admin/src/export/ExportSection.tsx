import { useMutation } from '@tanstack/react-query'
import { useId } from 'react'
import { api } from '../api'
import { saveResponse } from '../download'
import { apiRequestError, messageOf } from '../errors'
import styles from '../screens/screens.module.css'

/**
 * «Клиент не заложник» (принцип 8): сайт статическим архивом — то, что видят посетители, его
 * откроет любой веб-сервер, — и все данные сайта (страницы, история, картинки, заявки).
 * Данные — только владельцу и клиенту: в них заявки (решает API, здесь — только не предлагаем)
 */
export function ExportSection({
  siteId,
  canExportData,
}: {
  siteId: string
  canExportData: boolean
}) {
  const headingId = useId()

  const site = useMutation({
    mutationFn: async () => {
      const res = await api.sites[':siteId'].export.static.$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      await saveResponse(res, 'site.zip')
    },
  })
  const data = useMutation({
    mutationFn: async () => {
      const res = await api.sites[':siteId'].export.data.$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      await saveResponse(res, 'data.zip')
    },
  })

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId}>Выгрузка</h2>
      <p className={styles.muted}>
        Сайт архивом — готовые страницы и картинки, как их видят посетители: его можно выложить на
        любой хостинг.
        {canExportData &&
          ' Все данные — страницы с черновиками и историей, оригиналы картинок и заявки (в них персональные данные посетителей).'}
      </p>
      <div className={styles.actions}>
        <button type="button" disabled={site.isPending} onClick={() => site.mutate()}>
          {site.isPending ? 'Готовлю архив…' : 'Скачать сайт архивом'}
        </button>
        {canExportData && (
          <button type="button" disabled={data.isPending} onClick={() => data.mutate()}>
            {data.isPending ? 'Готовлю выгрузку…' : 'Выгрузить все данные'}
          </button>
        )}
      </div>
      {site.error && (
        <p role="alert" className={styles.formError}>
          Не удалось скачать сайт: {messageOf(site.error)}
        </p>
      )}
      {data.error && (
        <p role="alert" className={styles.formError}>
          Не удалось выгрузить данные: {messageOf(data.error)}
        </p>
      )}
    </section>
  )
}
