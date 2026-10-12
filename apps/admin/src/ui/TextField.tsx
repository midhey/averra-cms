import { useId } from 'react'
import styles from './ui.module.css'

type TextFieldProps = {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  error?: string | undefined
  hint?: string
  /** Неизменяемое начало значения, например «/» перед адресом страницы */
  prefix?: string
  type?: 'text' | 'email' | 'password'
  /** По умолчанию off: в формах админки подсказки браузера только мешают. Вход — исключение */
  autoComplete?: string
}

/** Поле с подписью. Подсказка и ошибка связаны с полем: диктор прочитает их вместе с подписью */
export function TextField({
  label,
  name,
  value,
  onChange,
  error,
  hint,
  prefix,
  type = 'text',
  autoComplete = 'off',
}: TextFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ')

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.control}>
        {prefix && (
          <span className={styles.prefix} aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={id}
          name={name}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          autoComplete={autoComplete}
        />
      </div>
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
