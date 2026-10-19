import { type ReactNode, useEffect, useId, useRef } from 'react'
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
  size?: 'small' | 'medium' | 'large'
}

/**
 * Окно поверх экрана — нативный <dialog> с showModal() (CONVENTIONS): фокус остаётся внутри,
 * Esc закрывает, фон недоступен, по закрытии браузер возвращает фокус туда, откуда открыли.
 * Состоянием владеет экран (`open`), окно только сообщает о закрытии
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'medium',
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={cx(styles.dialog, styles[size])}
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
