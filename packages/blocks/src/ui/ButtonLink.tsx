import type { BlockData } from '../types'
import styles from './ButtonLink.module.css'

export function ButtonLink({ label, href }: BlockData<'cta'>['button']) {
  return (
    <a className={styles.button} href={href}>
      {label}
    </a>
  )
}
