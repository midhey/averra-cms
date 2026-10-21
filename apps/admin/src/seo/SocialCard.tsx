import { cx } from '../ui/cx'
import { clip } from './page-seo-format'
import styles from './SocialCard.module.scss'

type SocialCardProps = {
  /** Домен сайта; пусто — адреса сайта нет */
  domain: string
  title: string
  description: string
  /** Картинка: своя, сайта или карточка из заголовка; нет — превью без картинки */
  image?: { src: string; alt: string } | undefined
  /** Что за картинка, словами: «своя», «картинка сайта», «карточка из заголовка» */
  imageNote: string
}

/**
 * Превью ссылки в мессенджере или соцсети: картинка 1.91 : 1, домен, заголовок og:title и
 * описание. Так выглядят карточки Telegram и VK — точный вид у каждой свой
 */
export function SocialCard({ domain, title, description, image, imageNote }: SocialCardProps) {
  return (
    <figure className={styles.card}>
      <figcaption className={styles.label}>
        Примерно так — ссылка в мессенджере · {imageNote}
      </figcaption>
      <div className={cx(styles.image, !image && styles.noImage)}>
        {image ? (
          <img src={image.src} alt={image.alt} loading="lazy" decoding="async" />
        ) : (
          <span>Без картинки</span>
        )}
      </div>
      <div className={styles.text}>
        {domain && <span className={styles.domain}>{domain}</span>}
        <span className={styles.title}>{clip(title, 90)}</span>
        {description && <span className={styles.description}>{description}</span>}
      </div>
    </figure>
  )
}
