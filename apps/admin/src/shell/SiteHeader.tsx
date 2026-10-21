import { Icon } from '../ui/Icon'
import styles from './Shell.module.scss'

type SiteHeaderProps = {
  name: string
  /** Адрес опубликованного сайта (SITE_URL у API). null — не задан: только название */
  url: string | null
}

/** Домен для подписи: без схемы, с портом, если он есть (localhost:4321 в разработке) */
export const siteDomain = (url: string) => new URL(url).host

/**
 * Заголовок боковой панели: название сайта и его домен. Одна установка — один сайт, поэтому
 * выбирать нечего: это не кнопка, а подпись. Домен — ссылка на опубликованный сайт в новой вкладке
 */
export function SiteHeader({ name, url }: SiteHeaderProps) {
  return (
    <div className={styles.site}>
      <span className={styles.siteName}>{name}</span>
      {url && (
        <a className={styles.siteDomain} href={url} target="_blank" rel="noopener noreferrer">
          <span className={styles.siteDomainText}>{siteDomain(url)}</span>
          <Icon name="external" size={14} />
          <span className="visually-hidden"> (сайт, откроется в новой вкладке)</span>
        </a>
      )}
    </div>
  )
}
