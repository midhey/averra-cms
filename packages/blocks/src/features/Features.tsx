import type { BlockComponentProps } from '../types'
import { Section } from '../ui/Section'
import styles from './Features.module.css'

export function Features({ id, data, headingLevel }: BlockComponentProps<'features'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const ItemHeading = headingLevel === 1 ? 'h2' : 'h3'
  return (
    <Section id={id} tone="muted">
      {data.title && <Heading className={styles.title}>{data.title}</Heading>}
      {/* biome-ignore lint/a11y/noRedundantRoles: Safari без маркеров списка теряет роль list */}
      <ul role="list" className={styles.grid} data-columns={data.columns}>
        {data.items.map((item, index) => (
          // У пунктов нет id. Ключ по индексу здесь безопасен: список рендерится статично
          <li key={index} className={styles.item}>
            <ItemHeading className={styles.itemTitle}>{item.title}</ItemHeading>
            {item.text && <p className={styles.itemText}>{item.text}</p>}
          </li>
        ))}
      </ul>
    </Section>
  )
}
