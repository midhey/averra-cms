import type { ReactNode } from 'react'
import styles from './EmptyState.module.scss'
import { Icon, type IconName } from './Icon'

type EmptyStateProps = {
  title: string
  icon?: IconName
  /** Что здесь появится и откуда: «Заявки приходят с форм на сайте» */
  children?: ReactNode
  /** Первое действие: «Создать страницу» */
  action?: ReactNode
  /** Уровень заголовка по месту на экране */
  headingLevel?: 2 | 3
}

/** Пусто, и это нормально: что здесь будет и что сделать первым */
export function EmptyState({ title, icon, children, action, headingLevel = 2 }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div className={styles.empty}>
      {icon && (
        <span className={styles.icon}>
          <Icon name={icon} size={22} />
        </span>
      )}
      <Heading className={styles.title}>{title}</Heading>
      {children && <div className={styles.text}>{children}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
