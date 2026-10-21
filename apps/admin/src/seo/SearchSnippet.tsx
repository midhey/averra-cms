import { cx } from '../ui/cx'
import { clip, type SearchEngine, SNIPPET_LIMITS } from './page-seo-format'
import styles from './SearchSnippet.module.scss'

type SearchSnippetProps = {
  /** Домен и путь: remont.example › ceny */
  address: string
  title: string
  description: string
  /**
   * Как у поисковика: заголовок и описание обрезаны по его пределу, у Google сверху название
   * сайта. Без него — общий пример строки (раздел «SEO» сайта)
   */
  engine?: SearchEngine
  /** Название сайта — строка над адресом у Google */
  siteName?: string
}

const captions: Record<SearchEngine | 'any', string> = {
  any: 'Так страница может выглядеть в поиске',
  yandex: 'Примерно так — в Яндексе',
  google: 'Примерно так — в Google',
}

/**
 * Пример строки в поиске: так поисковик, скорее всего, покажет страницу. Пустое описание —
 * подсказка, что поисковик возьмёт кусок текста сам
 */
export function SearchSnippet({
  address,
  title,
  description,
  engine,
  siteName,
}: SearchSnippetProps) {
  const limits = engine ? SNIPPET_LIMITS[engine] : undefined
  const shownTitle = limits ? clip(title, limits.title) : title
  const shownDescription =
    limits && description ? clip(description, limits.description) : description
  const addressLine = <span className={styles.address}>{address}</span>
  const titleLine = <span className={styles.title}>{shownTitle}</span>
  return (
    <figure className={cx(styles.snippet, engine && styles[engine])}>
      <figcaption className={styles.label}>{captions[engine ?? 'any']}</figcaption>
      {/* Google ставит сайт и адрес над заголовком, Яндекс — под ним */}
      {engine === 'google' ? (
        <>
          <span className={styles.site}>{siteName}</span>
          {addressLine}
          {titleLine}
        </>
      ) : (
        <>
          {engine === 'yandex' ? titleLine : addressLine}
          {engine === 'yandex' ? addressLine : titleLine}
        </>
      )}
      <span className={cx(styles.description, !description && styles.empty)}>
        {shownDescription || 'Описания нет: поисковик возьмёт кусок текста со страницы сам'}
      </span>
    </figure>
  )
}
