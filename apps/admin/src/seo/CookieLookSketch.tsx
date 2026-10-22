import type { CookieLook } from '@averra/schema'
import { cx } from '../ui/cx'
import styles from './CookieLookSketch.module.scss'

/** Миниатюра вида уведомления для карточки выбора: где на странице оно встанет */
export function CookieLookSketch({ look }: { look: CookieLook }) {
  return (
    <span className={cx(styles.sketch, look === 'modal' && styles.dimmed)}>
      <span className={styles.line} />
      <span className={cx(styles.line, styles.short)} />
      <span className={styles[look]} />
    </span>
  )
}
