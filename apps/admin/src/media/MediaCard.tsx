import type { ReactNode } from 'react'
import { cx } from '../ui/cx'
import { Icon } from '../ui/Icon'
import styles from './MediaCard.module.scss'

type MediaCardProps = {
  /** Превью; нет — значок картинки */
  thumbnail?: string | undefined
  /** Имя файла; нет — только строка meta */
  name?: string | undefined
  /** Размеры и форматы или почему картинки нет: «Картинка не выбрана» */
  meta: ReactNode
  /** Кнопка справа: «Выбрать картинку», «Заменить» */
  action: ReactNode
  /** Ошибка у поля: красная рамка (сам текст ошибки — под карточкой) */
  invalid?: boolean
  /** Превью квадратом и целиком — для иконки сайта */
  square?: boolean
  /** Превью целиком, без обрезки (SVG-логотип) */
  whole?: boolean
}

/** Карточка картинки в поле выбора из медиатеки: превью, имя и размеры, действие */
export function MediaCard({
  thumbnail,
  name,
  meta,
  action,
  invalid,
  square,
  whole,
}: MediaCardProps) {
  return (
    <div className={styles.card} data-invalid={invalid ? true : undefined}>
      {thumbnail ? (
        <img
          className={cx(styles.thumb, square && styles.square, whole && styles.whole)}
          src={thumbnail}
          alt=""
        />
      ) : (
        <span className={cx(styles.placeholder, square && styles.square)} aria-hidden="true">
          <Icon name="media" />
        </span>
      )}
      <span className={styles.about}>
        {name && <span className={styles.name}>{name}</span>}
        <span className={styles.meta}>{meta}</span>
      </span>
      {action}
    </div>
  )
}
