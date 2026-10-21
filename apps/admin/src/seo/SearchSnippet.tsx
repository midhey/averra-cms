import { cx } from '../ui/cx'
import styles from './SearchSnippet.module.scss'

type SearchSnippetProps = {
  /** Домен и путь: remont.example › ceny */
  address: string
  title: string
  description: string
}

/**
 * Пример строки в поиске: так поисковик, скорее всего, покажет страницу. Пустое описание —
 * подсказка, что поисковик возьмёт кусок текста сам
 */
export function SearchSnippet({ address, title, description }: SearchSnippetProps) {
  return (
    <figure className={styles.snippet}>
      <figcaption className={styles.label}>Так страница может выглядеть в поиске</figcaption>
      <span className={styles.address}>{address}</span>
      <span className={styles.title}>{title}</span>
      <span className={cx(styles.description, !description && styles.empty)}>
        {description || 'Описания нет: поисковик возьмёт кусок текста со страницы сам'}
      </span>
    </figure>
  )
}
