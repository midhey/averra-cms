import type { MediaMap } from '@averra/schema'
import { Picture } from '../ui/Picture'
import styles from './Brand.module.css'
import type { SiteBrandView } from './view'

type BrandProps = {
  brand: SiteBrandView
  siteName: string
  /** Картинки сайта: логотип берёт из справочника адреса вариантов */
  media: MediaMap
  /** В шапке логотип крупнее, в подвале — мельче */
  size: 'header' | 'footer'
}

/**
 * Логотип сайта — содержимое ссылки на главную в шапке и знак в подвале: картинка, знак
 * акцентным шрифтом и подпись (до двух строк) с разделителем. Картинки нет в медиатеке — вместо
 * неё подпись или название сайта, как было всегда. Имя для диктора — подпись: знак — украшение
 * (aria-hidden), картинка при подписи — тоже (alt=""), без подписи её alt — название сайта
 */
export function Brand({ brand, siteName, media, size }: BrandProps) {
  const image = brand.image && media[brand.image] ? brand.image : null
  const text = brand.text ?? (image ? null : siteName)
  const divided = text !== null && (image !== null || brand.mark !== '')
  return (
    <span className={styles.brand} data-size={size} data-part="brand">
      {image && (
        <Picture
          image={{ mediaId: image, alt: text === null ? siteName : '' }}
          media={media}
          sizes="12rem"
          priority={false}
          eager
          className={styles.logo}
        />
      )}
      {!image && brand.mark && (
        <span className={styles.mark} data-part="mark" aria-hidden="true">
          {brand.mark}
        </span>
      )}
      {text !== null && (
        <span className={styles.name} data-part="name" data-divided={divided ? '' : undefined}>
          {text}
        </span>
      )}
    </span>
  )
}
