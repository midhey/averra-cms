import type { ReactNode } from 'react'
import styles from './Section.module.css'

type SectionProps = {
  id: string
  tone?: 'plain' | 'muted'
  children: ReactNode
}

export function Section({ id, tone = 'plain', children }: SectionProps) {
  return (
    <section id={id} className={styles.section} data-tone={tone}>
      <div className={styles.inner}>{children}</div>
    </section>
  )
}
