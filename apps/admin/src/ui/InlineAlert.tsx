import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'
import styles from './InlineAlert.module.scss'

export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

const toneIcons: Record<AlertTone, IconName> = {
  info: 'info',
  success: 'check',
  warning: 'warning',
  danger: 'warning',
}

type InlineAlertProps = {
  tone: AlertTone
  title?: ReactNode
  children?: ReactNode
  /** Кнопка рядом: «Повторить», «Открыть настройки» */
  action?: ReactNode
}

/**
 * Сообщение внутри экрана. Ошибка — role="alert": диктор прочитает её сразу, как она появилась
 * (общая ошибка формы, CONVENTIONS). Остальные тоны — обычный текст
 */
export function InlineAlert({ tone, title, children, action }: InlineAlertProps) {
  return (
    <div className={cx(styles.alert, styles[tone])} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={toneIcons[tone]} className={styles.icon} />
      <div className={styles.body}>
        {title && <p className={styles.title}>{title}</p>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
