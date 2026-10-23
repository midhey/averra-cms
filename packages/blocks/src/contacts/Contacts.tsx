import { mapUrl, telHref } from '@averra/schema'
import type { BlockComponentProps } from '../types'
import { Picture } from '../ui/Picture'
import { Section } from '../ui/Section'
import styles from './Contacts.module.css'

// Картинка карты — половина контейнера на широком экране и вся ширина на узком
const MAP_SIZES = '(min-width: 72rem) 36rem, (min-width: 48rem) 50vw, 100vw'

/**
 * Контакты: address со списком «что — значение». Телефон и почта — ссылки tel: и mailto:, карта —
 * ссылкой на Яндекс Карты или 2ГИС (чужую карту не встраиваем до согласия посетителя), по желанию
 * рядом картинка карты из медиатеки
 */
export function Contacts({ id, data, headingLevel, media }: BlockComponentProps<'contacts'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const map = mapUrl({
    service: data.mapService,
    coordinates: data.coordinates,
    address: data.address,
  })
  const mapImage = data.mapImage && media[data.mapImage.mediaId] ? data.mapImage : undefined
  return (
    <Section id={id}>
      <div className={styles.layout} data-map={mapImage ? 'image' : 'none'}>
        <div className={styles.card} data-tone={data.tone}>
          {data.title && <Heading className={styles.title}>{data.title}</Heading>}
          {data.text && <p className={styles.text}>{data.text}</p>}
          <address className={styles.address}>
            <dl className={styles.list}>
              {data.phone && (
                <div className={styles.row}>
                  <dt className={styles.term}>Телефон</dt>
                  <dd className={styles.value}>
                    <a className={styles.strong} href={telHref(data.phone)}>
                      {data.phone}
                    </a>
                  </dd>
                </div>
              )}
              {data.email && (
                <div className={styles.row}>
                  <dt className={styles.term}>Почта</dt>
                  <dd className={styles.value}>
                    <a className={styles.link} href={`mailto:${data.email}`}>
                      {data.email}
                    </a>
                  </dd>
                </div>
              )}
              {data.address && (
                <div className={styles.row}>
                  <dt className={styles.term}>Адрес</dt>
                  <dd className={styles.value}>{data.address}</dd>
                </div>
              )}
              {data.hours && (
                <div className={styles.row}>
                  <dt className={styles.term}>Часы работы</dt>
                  <dd className={styles.value}>{data.hours}</dd>
                </div>
              )}
            </dl>
            {map && (
              <a className={styles.mapLink} href={map}>
                Открыть на карте
              </a>
            )}
          </address>
        </div>
        {mapImage && (
          <Picture
            image={mapImage}
            media={media}
            sizes={MAP_SIZES}
            priority={false}
            className={styles.map}
          />
        )}
      </div>
    </Section>
  )
}
