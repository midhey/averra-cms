import type { ReactNode } from 'react'
import { cx } from './cx'
import styles from './StatusPill.module.scss'

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

type StatusPillProps = {
  tone: StatusTone
  /** pill — плашка на цветном фоне (таблицы), dot — точка и текст (строка сведений) */
  appearance?: 'pill' | 'dot'
  children: ReactNode
}

/**
 * Состояние словами и цветом: «Опубликована», «Черновик», «Есть правки», «Новая», «Ошибка».
 * Цвет только помогает — смысл несёт текст, а точки тонов различаются ещё и по светлоте
 */
export function StatusPill({ tone, appearance = 'pill', children }: StatusPillProps) {
  return (
    <span className={cx(styles.status, styles[appearance], styles[tone])}>
      <span className={styles.indicator} aria-hidden="true" />
      {children}
    </span>
  )
}
