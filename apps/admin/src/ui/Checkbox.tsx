import { type ComponentPropsWithRef, type ReactNode, useId } from 'react'
import styles from './Checkbox.module.scss'
import { CHECKBOX_STYLE, type CheckboxStyle } from './control-style'
import { cx } from './cx'

type CheckboxProps = Omit<ComponentPropsWithRef<'input'>, 'id' | 'type'> & {
  label: ReactNode
  hint?: ReactNode
  error?: string | undefined
  variant?: CheckboxStyle
  indeterminate?: boolean
}

/** Частичный выбор — DOM-свойство input: диктор получает нативное состояние mixed. */
export function Checkbox({
  label,
  hint,
  error,
  variant = CHECKBOX_STYLE,
  indeterminate = false,
  ref,
  className,
  'aria-describedby': ownDescribedBy,
  ...rest
}: CheckboxProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [ownDescribedBy, hint && hintId, error && errorId].filter(Boolean).join(' ')
  return (
    <div className={cx(styles.control, styles[variant], className)}>
      <label className={styles.row} htmlFor={id}>
        <input
          {...rest}
          ref={(node) => {
            if (node) node.indeterminate = indeterminate
            if (typeof ref === 'function') return ref(node)
            if (ref) ref.current = node
          }}
          id={id}
          type="checkbox"
          className={styles.input}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : rest['aria-invalid']}
        />
        <span className={styles.box} aria-hidden="true">
          <svg viewBox="0 0 18 18" fill="none" className={styles.mark} aria-hidden="true">
            <path className={styles.tick} d="M3.5 9.5 7 13l7.5-8" />
            <path className={styles.dash} d="M4 9h10" />
          </svg>
        </span>
        <span>{label}</span>
      </label>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
