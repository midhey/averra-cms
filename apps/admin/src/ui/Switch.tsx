import { type ComponentPropsWithRef, type ReactNode, useId } from 'react'
import { SWITCH_STYLE, type SwitchStyle } from './control-style'
import { cx } from './cx'
import { Icon } from './Icon'
import styles from './Switch.module.scss'

type SwitchProps = Omit<ComponentPropsWithRef<'input'>, 'id' | 'type' | 'role'> & {
  label: ReactNode
  hint?: ReactNode
  error?: string | undefined
  variant?: SwitchStyle
}

/** Нативный input сохраняет поведение формы и клавиатуры при любой внешности. */
export function Switch({
  label,
  hint,
  error,
  variant = SWITCH_STYLE,
  className,
  'aria-describedby': ownDescribedBy,
  ...rest
}: SwitchProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [ownDescribedBy, hint && hintId, error && errorId].filter(Boolean).join(' ')
  return (
    <div className={cx(styles.control, styles[variant], className)}>
      <label className={styles.row} htmlFor={id}>
        <input
          {...rest}
          id={id}
          type="checkbox"
          // biome-ignore lint/a11y/useAriaPropsForRole: Нативный input передаёт checked роли switch без дублирования состояния в aria-checked.
          role="switch"
          className={styles.input}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : rest['aria-invalid']}
        />
        <span className={styles.track} aria-hidden="true">
          <span className={styles.thumb}>
            {variant === 'icon' && (
              <>
                <Icon name="check" size={12} className={styles.onIcon} />
                <Icon name="close" size={12} className={styles.offIcon} />
              </>
            )}
          </span>
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
