import type { ReactNode } from 'react'
import styles from './Section.module.css'

type SectionProps = {
  id: string
  tone?: 'plain' | 'muted'
  /** compact — меньше отступов: блоки «Текст» подряд читаются одним документом */
  density?: 'normal' | 'compact'
  children: ReactNode
}

export function Section({ id, tone = 'plain', density = 'normal', children }: SectionProps) {
  return (
    <section id={id} className={styles.section} data-tone={tone} data-density={density}>
      <div className={styles.inner}>{children}</div>
    </section>
  )
}
