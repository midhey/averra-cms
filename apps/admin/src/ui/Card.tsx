import type { HTMLAttributes } from 'react'
import styles from './Card.module.scss'
import { cx } from './cx'

type CardLook = {
  /** none — содержимое само задаёт поля (таблица), compact — плотнее (заявка в списке) */
  padding?: 'normal' | 'compact' | 'none' | undefined
  /** Вся карточка — ссылка или кнопка: подсветка при наведении */
  interactive?: boolean | undefined
}

/** Вид карточки для ссылки роутера: карточка-цифра «Новые заявки», заявка в списке */
export function cardClassName({ padding = 'normal', interactive = false }: CardLook = {}) {
  return cx(styles.card, styles[padding], interactive && styles.interactive)
}

type CardProps = HTMLAttributes<HTMLElement> &
  CardLook & {
    as?: 'div' | 'section' | 'article' | 'li'
  }

/** Белая поверхность с рамкой: раздел экрана, карточка-цифра, заявка */
export function Card({ as: Tag = 'div', padding, interactive, className, ...rest }: CardProps) {
  return <Tag {...rest} className={cx(cardClassName({ padding, interactive }), className)} />
}
