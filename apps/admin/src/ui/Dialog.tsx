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
  /**
   * Esc закрывает окно (по умолчанию да). false — Esc ничего не делает: окно с тем, что нельзя
   * потерять случайно (токен, который показывается один раз). Закрывают кнопки окна
   */
  escapeCloses?: boolean
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
  escapeCloses = true,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  // Кто был в фокусе до открытия: туда возвращаем фокус, если браузер сам этого не сделает
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      const active = document.activeElement
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null
      dialog.showModal()
      initialFocus?.current?.focus()
    }
    if (!open && dialog.open) {
      dialog.close()
      // Фокус вернул браузер, а дальше им распоряжается экран
      opener.current = null
    }
  }, [open, initialFocus])

  // Экран убрал окно из DOM открытым (`{item && <Dialog open …/>}`): закрытия не было, и браузер
  // фокус не вернёт — он оказался бы на body. Возвращаем на кнопку, которая открыла окно, если
  // она ещё на странице. В StrictMode React пробно размонтирует и монтирует эффекты заново (ref при
  // этом тоже сбрасывается): тогда окно ещё в документе — это не уход, ничего не делаем
  useEffect(() => {
    const dialog = ref.current
    return () => {
      if (dialog?.isConnected) return
      const element = opener.current
      opener.current = null
      if (element?.isConnected) element.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className={cx(styles.dialog, styles[size])}
      role={role}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // Esc при escapeCloses={false} не закрывает окно
      onCancel={(event) => {
        if (!escapeCloses) event.preventDefault()
      }}
      // Событие close приходит и после Esc: экран узнаёт, что окна больше нет
      onClose={() => {
        opener.current = null
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
