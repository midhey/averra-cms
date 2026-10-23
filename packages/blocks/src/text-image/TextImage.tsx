import type { BlockComponentProps } from '../types'
import { ButtonLink } from '../ui/ButtonLink'
import { Picture } from '../ui/Picture'
import { Section } from '../ui/Section'
import { TextBody } from '../ui/TextBody'
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
  // Картинки нет в справочнике (предпросмотр без медиа) — раскладка как без картинки
  const image = data.image && media[data.image.mediaId] ? data.image : undefined
  return (
    <Section id={id}>
      <div className={styles.layout} data-image={image ? data.imagePosition : 'none'}>
        <div className={styles.text}>
          {data.title && <Heading className={styles.title}>{data.title}</Heading>}
          <TextBody body={data.body} headingLevel={headingLevel} />
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
