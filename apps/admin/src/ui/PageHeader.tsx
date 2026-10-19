import type { ReactNode } from 'react'
import styles from './PageHeader.module.scss'

type PageHeaderProps = {
  title: ReactNode
  /** Над заголовком: где мы (название сайта) */
  eyebrow?: ReactNode
  /** Строка сведений под заголовком: адрес сайта, состояние публикации */
  meta?: ReactNode
  /** Действия экрана справа: «Новая страница», «Опубликовать правки» */
  actions?: ReactNode
  /** Слева от заголовка: кнопка-иконка «Назад к сайту» */
  back?: ReactNode
}

/** Шапка экрана: заголовок h1, сведения и действия. На узком экране действия уходят вниз */
export function PageHeader({ title, eyebrow, meta, actions, back }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.main}>
        {back}
        <div className={styles.text}>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h1 className={styles.title}>{title}</h1>
          {meta && <div className={styles.meta}>{meta}</div>}
        </div>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  )
}
