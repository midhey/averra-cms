import { type ReactNode, type RefObject, useEffect, useId, useRef } from 'react'
import { IconButton } from './Button'
import { cx } from './cx'
import styles from './Dialog.module.scss'

type DialogProps = {
  open: boolean
  /** Окно закрыли: Esc, кнопка «Закрыть» или действие внутри */
  onClose: () => void
  title: string
  description?: ReactNode
  children?: ReactNode
  /** Кнопки внизу: «Отмена», «Удалить» */
  footer?: ReactNode
  /** large — сетка внутри окна (медиатека), wide — каталог блоков в четыре колонки */
  size?: 'small' | 'medium' | 'large' | 'wide'
  /**
   * alertdialog — вопрос, на который надо ответить (подтверждение): диктор сразу читает его
   * вместе с описанием
   */
  role?: 'alertdialog'
  /**
   * Куда поставить фокус при открытии. Без него браузер ставит его на первую кнопку окна —
   * «Закрыть». Подтверждение ставит его на безопасную кнопку («Отмена»), а не на «Удалить»
   */
  initialFocus?: RefObject<HTMLElement | null>
}

/**
 * Окно поверх экрана — нативный <dialog> с showModal() (документация: Разработчику → Соглашения,
 * «Админка»): фокус остаётся внутри, Esc закрывает, фон недоступен, по закрытии браузер возвращает
 * фокус туда, откуда открыли. Состоянием владеет экран (`open`), окно только сообщает о закрытии
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'medium',
  role,
  initialFocus,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      initialFocus?.current?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open, initialFocus])

  return (
    <dialog
      ref={ref}
      className={cx(styles.dialog, styles[size])}
      role={role}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // Событие close приходит и после Esc: экран узнаёт, что окна больше нет
      onClose={() => {
        if (open) onClose()
      }}
    >
      <div className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <IconButton label="Закрыть" icon="close" size="small" onClick={onClose} />
      </div>
      {description && (
        <div id={descriptionId} className={styles.description}>
          {description}
        </div>
      )}
      {children && <div className={styles.body}>{children}</div>}
      {footer && <div className={styles.footer}>{footer}</div>}
    </dialog>
  )
}
