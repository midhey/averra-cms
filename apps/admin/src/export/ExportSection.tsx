import { useMutation } from '@tanstack/react-query'
import { api } from '../api'
import { saveResponse } from '../download'
import { apiRequestError, messageOf } from '../errors'
import { Button } from '../ui/Button'
import { InlineAlert } from '../ui/InlineAlert'
import { FormActions, mutedClassName, Section } from '../ui/Screen'

/**
 * «Клиент не заложник» (принцип 8): сайт статическим архивом — то, что видят посетители, его
 * откроет любой веб-сервер, — и все данные сайта (страницы, история, картинки, заявки).
 * Данные — только владельцу и клиенту: в них заявки (решает API, здесь — только не предлагаем)
 */
export function ExportSection({
  siteId,
  canExportData,
  id,
}: {
  siteId: string
  canExportData: boolean
  id?: string
}) {
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
    <Section id={id} title="Выгрузка" card>
      <p className={mutedClassName}>
        Сайт архивом — готовые страницы и картинки, как их видят посетители: его можно выложить на
        любой хостинг.
        {canExportData &&
          ' Все данные — страницы с черновиками и историей, оригиналы картинок и заявки (в них персональные данные посетителей).'}
      </p>
      <FormActions>
        <Button icon="download" loading={site.isPending} onClick={() => site.mutate()}>
          {site.isPending ? 'Готовлю архив…' : 'Скачать сайт архивом'}
        </Button>
        {canExportData && (
          <Button icon="download" loading={data.isPending} onClick={() => data.mutate()}>
            {data.isPending ? 'Готовлю выгрузку…' : 'Выгрузить все данные'}
          </Button>
        )}
      </FormActions>
      {site.error && (
        <InlineAlert tone="danger">Не удалось скачать сайт: {messageOf(site.error)}</InlineAlert>
      )}
      {data.error && (
        <InlineAlert tone="danger">
          Не удалось выгрузить данные: {messageOf(data.error)}
        </InlineAlert>
      )}
    </Section>
  )
}
