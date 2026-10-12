import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { messageOf } from '../errors'
import { formatDateTime } from '../pages-format'
import { revisionsQuery } from '../queries'
import styles from './History.module.css'
import { authorLabel, type RevisionAuthor } from './history-format'

export type HistoryRevision = {
  id: string
  version: number
  title: string
  publishedAt: string
  author: RevisionAuthor
}

type HistoryProps = {
  /** id панели: на него ссылается кнопка «История» через aria-controls */
  id: string
  siteId: string
  slug: string
  selectedId: string | null
  restoring: boolean
  onSelect: (revision: HistoryRevision | null) => void
  onRestore: (revision: HistoryRevision) => void
}

/**
 * Публикации страницы, новые сверху. Выбранную версию редактор показывает в предпросмотре,
 * а отсюда её можно вернуть в черновик. Верхняя версия — та, что сейчас на сайте:
 * опубликованное меняет только публикация, и каждая публикация пишет версию
 */
export function History(props: HistoryProps) {
  const { id, siteId, slug, selectedId, restoring, onSelect, onRestore } = props
  const headingId = useId()
  const { data: revisions, error, isPending } = useQuery(revisionsQuery(siteId, slug))
  const selected = revisions?.find((revision) => revision.id === selectedId)

  return (
    <aside id={id} className={styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        История публикаций
      </h2>

      {isPending && <p className={styles.empty}>Загружаю историю…</p>}
      {error && (
        <p className={styles.error} role="alert">
          Не удалось загрузить историю: {messageOf(error)}
        </p>
      )}
      {revisions?.length === 0 && (
        <p className={styles.empty}>
          Страницу ещё не публиковали. Каждая публикация появится здесь.
        </p>
      )}

      {revisions && revisions.length > 0 && (
        <ol className={styles.list}>
          {revisions.map((revision, index) => (
            <li key={revision.id}>
              <button
                type="button"
                className={styles.item}
                aria-pressed={revision.id === selectedId}
                onClick={() => onSelect(revision.id === selectedId ? null : revision)}
              >
                <span className={styles.version}>
                  Версия {revision.version}
                  {index === 0 && <span className={styles.badge}>сейчас на сайте</span>}
                </span>
                <span className={styles.meta}>
                  {formatDateTime(revision.publishedAt)} · {authorLabel(revision.author)}
                </span>
                <span className={styles.title}>{revision.title}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {selected && (
        <div className={styles.footer}>
          <p className={styles.hint}>
            Черновик заменится версией {selected.version}. Сайт не изменится, пока черновик не
            опубликуют.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={restoring}
              onClick={() => onRestore(selected)}
            >
              Вернуть в черновик
            </button>
            <button type="button" onClick={() => onSelect(null)}>
              Показать черновик
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
