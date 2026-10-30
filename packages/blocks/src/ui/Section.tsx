import type { ReactNode } from 'react'
import { CUSTOM_BLOCK_ATTRIBUTE } from '../custom/marker'
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
  /** Ключ своего блока: по атрибуту data-custom-block его CSS находит только этот блок */
  customBlock?: string | undefined
  children: ReactNode
}

export function Section({
  id,
  tone = 'plain',
  density = 'normal',
  backdrop,
  customBlock,
  children,
}: SectionProps) {
  return (
    <section
      id={id}
      className={styles.section}
      data-tone={tone}
      data-density={density}
      data-backdrop={backdrop ? '' : undefined}
      {...(customBlock !== undefined && { [CUSTOM_BLOCK_ATTRIBUTE]: customBlock })}
    >
      {backdrop}
      <div className={styles.inner}>{children}</div>
    </section>
  )
}
