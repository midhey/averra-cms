import type { ReactNode } from 'react'
import styles from './Section.module.css'

type SectionProps = {
  id: string
  tone?: 'plain' | 'muted'
  /** compact — меньше отступов: блоки «Текст» подряд читаются одним документом */
  density?: 'normal' | 'compact'
  /**
   * Фон на весь блок под содержимым — фото «Первого экрана» на фото. Ложится и под отступы
   * блока: над ним может лечь прозрачная шапка сайта
   */
  backdrop?: ReactNode
  children: ReactNode
}

export function Section({
  id,
  tone = 'plain',
  density = 'normal',
  backdrop,
  children,
}: SectionProps) {
  return (
    <section
      id={id}
      className={styles.section}
      data-tone={tone}
      data-density={density}
      data-backdrop={backdrop ? '' : undefined}
    >
      {backdrop}
      <div className={styles.inner}>{children}</div>
    </section>
  )
}
