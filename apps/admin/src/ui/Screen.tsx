import { type ReactNode, type Ref, useId } from 'react'
import { cardClassName } from './Card'
import { cx } from './cx'
import styles from './Screen.module.scss'

/**
 * Экран внутри оболочки: свой <main> с полями и вертикальным ритмом концепта
 * (документация: Разработчику → Соглашения, «Админка»)
 */
export function Screen({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <main className={cx(styles.screen, narrow && styles.narrow)}>{children}</main>
}

type SectionProps = {
  title: ReactNode
  /** Под заголовком: что это за раздел */
  description?: ReactNode
  /** Справа от заголовка: «Все заявки», «Обновить», поиск */
  actions?: ReactNode
  /** Обернуть содержимое в карточку (форма, сведения). Таблица и сетка карточек — без неё */
  card?: boolean
  /** Заголовок, на который переводят фокус после удаления строки (tabIndex={-1}) */
  headingRef?: Ref<HTMLHeadingElement>
  /** Якорь раздела: ссылка «Подробнее» с другого экрана */
  id?: string
  children: ReactNode
}

/**
 * Раздел экрана — ориентир region с именем по заголовку h2: по нему его находит диктор
 * (и e2e). Заголовок и действия — строкой над содержимым, как «Страницы» и «Последние заявки»
 */
export function Section({
  title,
  description,
  actions,
  card,
  headingRef,
  id,
  children,
}: SectionProps) {
  const headingId = useId()
  return (
    <section id={id} aria-labelledby={headingId} className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionText}>
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className={styles.sectionTitle}
          >
            {title}
          </h2>
          {description && <div className={styles.sectionDescription}>{description}</div>}
        </div>
        {actions && <div className={styles.sectionActions}>{actions}</div>}
      </div>
      {card ? <div className={cx(cardClassName(), styles.cardBody)}>{children}</div> : children}
    </section>
  )
}

/** Сведения «название — значение» (почта, состояние установки, согласие посетителя) */
export function Facts({
  items,
  label,
}: {
  items: ReadonlyArray<readonly [ReactNode, ReactNode]>
  label?: string
}) {
  return (
    <dl className={styles.facts} aria-label={label}>
      {items.map(([term, value], index) => (
        // Строки сведений не переставляются: ключ по месту
        <div key={index} className={styles.fact}>
          <dt className={styles.term}>{term}</dt>
          <dd className={styles.value}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Строка формы с кнопками: «Сохранить», «Сохранить без проверки» */
export function FormActions({ children }: { children: ReactNode }) {
  return <div className={styles.formActions}>{children}</div>
}

/** Форма столбиком с ритмом концепта */
export const formClassName = styles.form
/** Приглушённый поясняющий текст */
export const mutedClassName = styles.muted
/** Моноширинный: адреса, версии */
export const monoClassName = styles.mono
