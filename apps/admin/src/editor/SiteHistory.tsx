import { useMutation, useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { api } from '../api'
import { apiRequestError, messageOf } from '../errors'
import { formatDateTime } from '../pages-format'
import { type SiteRevisionEntity, siteRevisionsQuery } from '../queries'
import { Button } from '../ui/Button'
import { useConfirm } from '../ui/Confirm'
import { InlineAlert } from '../ui/InlineAlert'
import { StatusPill } from '../ui/StatusPill'
import styles from './History.module.scss'
import { authorLabel, restoredMessage, restoreQuestion } from './history-format'

type Props = {
  siteId: string
  entity: SiteRevisionEntity
  canRestore: boolean
  unsaved: boolean
  busy: boolean
  onRestored: () => Promise<void>
}

/** История общих настроек: тот же возврат в черновик, что у страниц, без предпросмотра версии */
export function SiteHistory({ siteId, entity, canRestore, unsaved, busy, onRestored }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string>()
  const confirm = useConfirm()
  const history = useQuery({ ...siteRevisionsQuery(siteId, entity), enabled: open })
  const selected = history.data?.find((revision) => revision.id === selectedId)
  const restore = useMutation({
    mutationFn: async () => {
      if (!selected) return
      const res = await api.sites[':siteId'][entity].revisions[':revisionId'].restore.$post({
        param: { siteId, revisionId: selected.id },
      })
      if (!res.ok) throw await apiRequestError(res)
      await onRestored()
      setNotice(restoredMessage(selected, true))
    },
  })

  return (
    <div>
      <Button aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        История
      </Button>
      {open && (
        <section id={id} aria-label="История публикаций" className={styles.list}>
          <h2 className={styles.heading}>История публикаций</h2>
          {history.isPending && <p role="status">Загружаю историю…</p>}
          {history.error && (
            <InlineAlert tone="danger">
              Не удалось загрузить историю: {messageOf(history.error)}
            </InlineAlert>
          )}
          {history.data?.length === 0 && (
            <p>Публикаций пока нет. Каждая публикация появится здесь.</p>
          )}
          <ol className={styles.list}>
            {history.data?.map((revision) => (
              <li key={revision.id}>
                <button
                  type="button"
                  className={styles.item}
                  aria-pressed={selectedId === revision.id}
                  disabled={restore.isPending}
                  onClick={() => {
                    setSelectedId(revision.id)
                    setNotice(undefined)
                    restore.reset()
                  }}
                >
                  <span className={styles.version}>
                    Версия {revision.version}
                    {revision.current && <StatusPill tone="success">текущая</StatusPill>}
                  </span>
                  <span className={styles.meta}>
                    {formatDateTime(revision.publishedAt)} · {authorLabel(revision.author)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {selected && canRestore && (
            <div className={styles.actions}>
              <p className={styles.hint}>
                Черновик заменится версией {selected.version}. Сайт изменится после публикации.
              </p>
              <Button
                disabled={busy || restore.isPending}
                onClick={async () => {
                  if (
                    unsaved &&
                    !(await confirm({
                      title: restoreQuestion(selected),
                      confirmLabel: 'Вернуть в черновик',
                      tone: 'primary',
                    }))
                  )
                    return
                  setNotice(undefined)
                  restore.mutate()
                }}
              >
                Вернуть в черновик
              </Button>
            </div>
          )}
          {restore.error && (
            <InlineAlert tone="danger">
              Не удалось вернуть версию: {messageOf(restore.error)}
            </InlineAlert>
          )}
          {notice && (
            <InlineAlert tone="success" live>
              {notice}
            </InlineAlert>
          )}
        </section>
      )}
    </div>
  )
}
