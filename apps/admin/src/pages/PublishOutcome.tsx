import { messageOf } from '../errors'
import { pluralRu } from '../format/plural'
import { InlineAlert } from '../ui/InlineAlert'
import styles from './PublishOutcome.module.scss'
import type { PublishResult } from './publish-all'

type PublishOutcomeProps = {
  result: PublishResult | undefined
  error: unknown
}

/** Итог «Опубликовать правки»: всё вышло, вышло не всё (какие и почему) или запрос сорвался */
export function PublishOutcome({ result, error }: PublishOutcomeProps) {
  if (error)
    return <InlineAlert tone="danger">Не удалось опубликовать: {messageOf(error)}</InlineAlert>
  if (!result) return null
  if (result.failed.length === 0) {
    return (
      <InlineAlert tone="success" live>
        Правки опубликованы: {result.published}{' '}
        {pluralRu(result.published, ['страница', 'страницы', 'страниц'])}. Сайт обновится после
        сборки.
      </InlineAlert>
    )
  }
  return (
    <InlineAlert tone="danger" title="Не все правки опубликованы">
      {result.published > 0 && (
        <p>
          Опубликовано: {result.published}{' '}
          {pluralRu(result.published, ['страница', 'страницы', 'страниц'])}. Не вышли:
        </p>
      )}
      {/* Ключ — адрес: заголовки страниц могут совпадать, адрес на сайте — нет */}
      <ul className={styles.failures}>
        {result.failed.map((failure) => (
          <li key={failure.slug}>
            «{failure.title}»: {failure.message}
          </li>
        ))}
      </ul>
    </InlineAlert>
  )
}
