import type { ReactNode } from 'react'
import { Button } from '../ui/Button'
import styles from './Notifications.module.scss'
import { type RecipientView, recipientName } from './notifications-format'

/**
 * Получатели списком: имя (адрес или чат) и что получает, кнопка «Отвязать» с названием
 * получателя для диктора. children — что ещё у строки (флажки событий)
 */
export function RecipientList({
  label,
  recipients,
  meta,
  onRemove,
  removing,
  busy = false,
  removeLabel = () => 'Отвязать',
  extra,
}: {
  label: string
  recipients: readonly RecipientView[]
  meta: (recipient: RecipientView) => ReactNode
  onRemove: (recipient: RecipientView) => void
  /** Кого сейчас удаляют: у его кнопки — крутилка, остальные ждут */
  removing?: string | undefined
  /** Идёт другое действие со списком: кнопки ждут */
  busy?: boolean
  removeLabel?: (recipient: RecipientView) => string
  extra?: (recipient: RecipientView) => ReactNode
}) {
  return (
    <ul className={styles.recipients} aria-label={label}>
      {recipients.map((recipient) => (
        <li key={recipient.id} className={styles.recipient}>
          <span className={styles.recipientText}>
            <span className={styles.recipientName}>{recipientName(recipient)}</span>
            <span className={styles.recipientMeta}>{meta(recipient)}</span>
          </span>
          <Button
            size="small"
            variant="ghost"
            icon="close"
            loading={removing === recipient.id}
            disabled={busy || (removing !== undefined && removing !== recipient.id)}
            aria-label={`${removeLabel(recipient)}: ${recipientName(recipient)}`}
            onClick={() => onRemove(recipient)}
          >
            {removeLabel(recipient)}
          </Button>
          {extra?.(recipient)}
        </li>
      ))}
    </ul>
  )
}
