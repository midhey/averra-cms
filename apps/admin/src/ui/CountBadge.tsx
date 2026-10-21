import styles from './CountBadge.module.scss'
import { cx } from './cx'

type CountBadgeProps = {
  count: number
  /** warning — есть что поправить, danger — есть важное */
  tone: 'warning' | 'danger'
  className?: string | undefined
}

/**
 * Число на кнопке: «SEO 3». Для диктора оно скрыто — кнопка говорит его словами в своей подписи
 * («SEO: 3 совета»). Цвет только помогает: смысл несёт число и подпись
 */
export function CountBadge({ count, tone, className }: CountBadgeProps) {
  return (
    <span className={cx(styles.badge, styles[tone], className)} aria-hidden="true">
      {count}
    </span>
  )
}
