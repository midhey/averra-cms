import type { BlockComponentProps } from '../types'
import { ButtonLink } from '../ui/ButtonLink'
import { Picture } from '../ui/Picture'
import { Section } from '../ui/Section'
import styles from './Hero.module.css'

// Картинка в split занимает половину контейнера (72rem) на широком экране и всю ширину на узком
const SPLIT_SIZES = '(min-width: 72rem) 36rem, (min-width: 48rem) 50vw, 100vw'

export function Hero({ id, data, headingLevel, media, priority }: BlockComponentProps<'hero'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const text = (
    <div className={styles.hero} data-variant={data.variant}>
      <Heading className={styles.title}>{data.title}</Heading>
      {data.subtitle && <p className={styles.subtitle}>{data.subtitle}</p>}
      {data.button && <ButtonLink {...data.button} />}
    </div>
  )
  // На фото: снимок на весь блок, над ним — слой цвета текста темы (непрозрачность --cover-scrim
  // посчитана темой под любое фото), текст поверх — цветом фона темы
  if (data.variant === 'cover' && data.image && media[data.image.mediaId]) {
    return (
      <Section
        id={id}
        backdrop={
          <div className={styles.backdrop} data-hero-cover="">
            <Picture
              image={data.image}
              media={media}
              sizes="100vw"
              priority={priority}
              className={styles.photo}
            />
            <span className={styles.scrim} aria-hidden="true" />
          </div>
        }
      >
        <div className={styles.cover}>{text}</div>
      </Section>
    )
  }
  return (
    <Section id={id}>
      {data.variant === 'split' && data.image ? (
        <div className={styles.split}>
          {text}
          <Picture
            image={data.image}
            media={media}
            sizes={SPLIT_SIZES}
            priority={priority}
            className={styles.media}
          />
        </div>
      ) : (
        text
      )}
    </Section>
  )
}
