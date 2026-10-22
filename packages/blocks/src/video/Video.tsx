import { parseVideoUrl, videoEmbedUrl, videoProviderTitles, videoWatchUrl } from '@averra/schema'
import type { BlockComponentProps } from '../types'
import { Picture } from '../ui/Picture'
import { Section } from '../ui/Section'
import styles from './Video.module.css'

// Обложка на всю ширину контейнера (72rem) на широком экране и на весь экран на узком
const COVER_SIZES = '(min-width: 72rem) 72rem, 100vw'

/**
 * Ролик с площадки. На странице — только обложка и ссылка «Смотреть на …» на страницу ролика:
 * без JavaScript она просто открывает площадку в новой вкладке. Плеер (iframe площадки) ставит
 * скрипт player-dom.ts по клику, адрес плеера — в data-video-embed. До клика страница к площадке
 * не обращается: ни iframe, ни обложки площадки, ни preconnect. Рамка 16:9 держит место заранее.
 * Под плеером скрипт показывает ссылку на ролик — на случай, если плеер площадки не загрузится
 */
export function Video({ id, data, headingLevel, media, priority }: BlockComponentProps<'video'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  // Схема пропускает только разбираемые ссылки. Если всё же нет (старые данные) — без плеера
  const ref = parseVideoUrl(data.url)
  const provider = ref && videoProviderTitles[ref.provider]
  return (
    <Section id={id}>
      <div className={styles.video}>
        <Heading className={styles.title}>{data.title}</Heading>
        <figure className={styles.figure}>
          <div className={styles.frame} data-video-frame="">
            {ref ? (
              <a
                className={styles.cover}
                href={videoWatchUrl(ref)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Смотреть на ${provider}: ${data.title}`}
                data-video-embed={videoEmbedUrl(ref)}
                data-video-title={data.title}
              >
                {data.cover ? (
                  <Picture
                    image={data.cover}
                    media={media}
                    sizes={COVER_SIZES}
                    priority={priority}
                    className={styles.picture}
                  />
                ) : (
                  <span className={styles.placeholder} aria-hidden="true" />
                )}
                <span className={styles.play} aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    width="28"
                    height="28"
                    focusable="false"
                    aria-hidden="true"
                  >
                    <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
                  </svg>
                </span>
                <span className={styles.label}>Смотреть на {provider}</span>
              </a>
            ) : (
              <span className={styles.placeholder} />
            )}
          </div>
          {ref && (
            // Запасная ссылка: площадка может не открыться в iframe (сеть, блокировка) — тогда на
            // месте ролика пустой плеер, а обложки-ссылки уже нет. Показывает её скрипт плеера
            <a
              className={styles.fallback}
              href={videoWatchUrl(ref)}
              target="_blank"
              rel="noopener noreferrer"
              data-video-fallback=""
              hidden
            >
              Ролик не запускается? Откройте его на {provider}
            </a>
          )}
          {data.caption && <figcaption className={styles.caption}>{data.caption}</figcaption>}
        </figure>
      </div>
    </Section>
  )
}
