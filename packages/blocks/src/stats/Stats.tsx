import type { BlockComponentProps } from '../types'
import { Section } from '../ui/Section'
import styles from './Stats.module.css'

/**
 * Цифры: факты крупно. Список, а не таблица: число и подпись читаются вместе — «12 лет работаем».
 * Без заголовка у секции нет имени, и это нормально: цифры говорят сами за себя
 */
export function Stats({ id, data, headingLevel }: BlockComponentProps<'stats'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <Section id={id}>
      {data.title && <Heading className={styles.title}>{data.title}</Heading>}
      {/* biome-ignore lint/a11y/noRedundantRoles: Safari без маркеров списка теряет роль list */}
      <ul role="list" className={styles.grid} data-tone={data.tone} data-count={data.items.length}>
        {data.items.map((item, index) => (
          // У фактов нет id. Ключ по индексу здесь безопасен: список рендерится статично
          <li key={index} className={styles.item}>
            <span className={styles.value}>{item.value}</span>{' '}
            <span className={styles.label}>{item.label}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
