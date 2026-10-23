import { parseTextBody } from '@averra/schema'
import type { BlockComponentProps } from '../types'
import { ButtonLink } from '../ui/ButtonLink'
import { Picture } from '../ui/Picture'
import { Section } from '../ui/Section'
import styles from './TextImage.module.css'

// Картинка — половина контейнера (72rem) на широком экране и вся ширина на узком
const IMAGE_SIZES = '(min-width: 72rem) 36rem, (min-width: 48rem) 50vw, 100vw'

/**
 * Текст с картинкой. В разметке текст идёт первым — диктор и поисковик читают заголовок раньше
 * картинки; слева картинку ставит сетка. Без картинки — просто текст
 */
export function TextImage({
  id,
  data,
  headingLevel,
  media,
  priority,
}: BlockComponentProps<'text-image'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const SubHeading = headingLevel === 1 ? 'h2' : 'h3'
  // Картинки нет в справочнике (предпросмотр без медиа) — раскладка как без картинки
  const image = data.image && media[data.image.mediaId] ? data.image : undefined
  return (
    <Section id={id}>
      <div className={styles.layout} data-image={image ? data.imagePosition : 'none'}>
        <div className={styles.text}>
          {data.title && <Heading className={styles.title}>{data.title}</Heading>}
          {parseTextBody(data.body).map((part, index) => {
            // Части текста не переставляются и рендерятся статично: ключ по месту
            switch (part.kind) {
              case 'heading':
                return (
                  <SubHeading key={index} className={styles.subtitle}>
                    {part.text}
                  </SubHeading>
                )
              case 'list':
                return (
                  <ul key={index} className={styles.list}>
                    {part.items.map((item, itemIndex) => (
                      <li key={itemIndex}>{item}</li>
                    ))}
                  </ul>
                )
              default:
                return <p key={index}>{part.text}</p>
            }
          })}
          {data.button && (
            <div className={styles.action}>
              <ButtonLink {...data.button} />
            </div>
          )}
        </div>
        {image && (
          <Picture
            image={image}
            media={media}
            sizes={IMAGE_SIZES}
            priority={priority}
            className={styles.media}
          />
        )}
      </div>
    </Section>
  )
}
