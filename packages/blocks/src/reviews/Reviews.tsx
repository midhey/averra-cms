import { splitParagraphs } from '@averra/schema'
import type { BlockComponentProps } from '../types'
import { Picture } from '../ui/Picture'
import { Section } from '../ui/Section'
import styles from './Reviews.module.css'

/**
 * Отзывы: figure с цитатой (blockquote) и подписью автора (figcaption) — по HTML подпись стоит
 * вне цитаты: слова автора отдельно, кто он — отдельно
 */
export function Reviews({ id, data, headingLevel, media }: BlockComponentProps<'reviews'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <Section id={id}>
      {data.title && <Heading className={styles.title}>{data.title}</Heading>}
      {/* biome-ignore lint/a11y/noRedundantRoles: Safari без маркеров списка теряет роль list */}
      <ul role="list" className={styles.grid} data-columns={data.columns}>
        {data.items.map((item, index) => (
          // У отзывов нет id. Ключ по индексу здесь безопасен: список рендерится статично
          <li key={index}>
            <figure className={styles.card}>
              <blockquote className={styles.quote}>
                {splitParagraphs(item.quote).map((paragraph, paragraphIndex) => (
                  <p key={paragraphIndex}>{paragraph}</p>
                ))}
              </blockquote>
              <figcaption className={styles.author}>
                {item.photo && media[item.photo.mediaId] && (
                  <Picture
                    image={item.photo}
                    media={media}
                    sizes="3rem"
                    priority={false}
                    className={styles.photo}
                  />
                )}
                <span className={styles.who}>
                  <span className={styles.name}>{item.name}</span>
                  {item.caption && <span className={styles.caption}>{item.caption}</span>}
                </span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </Section>
  )
}
