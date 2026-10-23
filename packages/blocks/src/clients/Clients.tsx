import type { BlockComponentProps } from '../types'
import { Picture } from '../ui/Picture'
import { Section } from '../ui/Section'
import styles from './Clients.module.css'

/**
 * Клиенты: ряд логотипов. Alt логотипа — название клиента; нет логотипа (или его нет в
 * справочнике) — название стоит текстом, и ряд не пустеет
 */
export function Clients({ id, data, headingLevel, media }: BlockComponentProps<'clients'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <Section id={id}>
      {data.title && <Heading className={styles.title}>{data.title}</Heading>}
      {/* biome-ignore lint/a11y/noRedundantRoles: Safari без маркеров списка теряет роль list */}
      <ul role="list" className={styles.row} data-tone={data.tone}>
        {data.items.map((item, index) => (
          // У клиентов нет id. Ключ по индексу здесь безопасен: список рендерится статично
          <li key={index} className={styles.item}>
            {item.logo && media[item.logo.mediaId] ? (
              <Picture
                image={{ mediaId: item.logo.mediaId, alt: item.name }}
                media={media}
                sizes="12rem"
                priority={false}
                className={styles.logo}
              />
            ) : (
              <span className={styles.name}>{item.name}</span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}
