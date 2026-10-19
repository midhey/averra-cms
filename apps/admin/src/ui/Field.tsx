import { type ComponentPropsWithRef, type ReactNode, useId } from 'react'
import { cx } from './cx'
import styles from './Field.module.scss'

/** Что поле передаёт своему элементу ввода: id для подписи, связи с подсказкой и ошибкой */
export type FieldControlProps = {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

type FieldOwnProps = {
  label: ReactNode
  /** Подсказка под полем: диктор прочитает её вместе с подписью */
  hint?: ReactNode
  /** Ошибка поля: красная рамка, текст под полем, aria-invalid */
  error?: string | undefined
  /** Подпись только для диктора (поле поиска с иконкой и плейсхолдером) */
  hideLabel?: boolean
  /** Свои описания экрана (id через пробел): поле добавит к ним подсказку, счётчик и ошибку */
  'aria-describedby'?: string | undefined
}

type FieldProps = FieldOwnProps & {
  /** Счётчик символов «49 из 120 символов» */
  counter?: { length: number; max: number } | undefined
  className?: string
  children: (control: FieldControlProps) => ReactNode
}

/** «символа» или «символов» после «из N» */
function charactersAfter(max: number) {
  return max % 10 === 1 && max % 100 !== 11 ? 'символа' : 'символов'
}

export function counterText(length: number, max: number) {
  return `${length} из ${max} ${charactersAfter(max)}`
}

/**
 * Подпись, подсказка, счётчик и ошибка вокруг любого элемента ввода. Счётчик не ставит
 * maxLength: вставленный длинный текст не обрезается молча, превышение видно, а ловит его схема
 */
export function Field({
  label,
  hint,
  error,
  hideLabel,
  counter,
  className,
  children,
  'aria-describedby': ownDescribedBy,
}: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const counterId = `${id}-counter`
  const errorId = `${id}-error`
  const over = counter !== undefined && counter.length > counter.max
  const describedBy = [ownDescribedBy, hint && hintId, counter && counterId, error && errorId]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={id} className={cx(styles.label, hideLabel && 'visually-hidden')}>
        {label}
      </label>
      {children({
        id,
        ...(describedBy && { 'aria-describedby': describedBy }),
        ...((error || over) && { 'aria-invalid': true }),
      })}
      {(hint || counter) && (
        <div className={styles.meta}>
          {hint && (
            <p id={hintId} className={styles.hint}>
              {hint}
            </p>
          )}
          {counter && (
            <p id={counterId} className={cx(styles.counter, over && styles.counterOver)}>
              {counterText(counter.length, counter.max)}
            </p>
          )}
        </div>
      )}
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}

type CounterProps = {
  /** Предел для счётчика символов; без него счётчика нет */
  maxChars?: number
}

function counterOf(value: unknown, maxChars: number | undefined) {
  if (maxChars === undefined) return undefined
  return { length: typeof value === 'string' ? value.length : 0, max: maxChars }
}

type TextInputProps = Omit<ComponentPropsWithRef<'input'>, 'id' | 'prefix'> &
  FieldOwnProps &
  CounterProps & {
    /** Моноширинный шрифт: адреса, ссылки, id */
    mono?: boolean
    /** Неизменяемое начало значения, например «/» перед адресом страницы */
    prefix?: string
  }

export function TextInput({
  label,
  hint,
  error,
  hideLabel,
  maxChars,
  mono,
  prefix,
  className,
  autoComplete = 'off',
  'aria-describedby': ownDescribedBy,
  ...rest
}: TextInputProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      aria-describedby={ownDescribedBy}
      counter={counterOf(rest.value, maxChars)}
      className={className}
    >
      {(control) => (
        <div className={styles.control}>
          {prefix && (
            <span className={styles.prefix} aria-hidden="true">
              {prefix}
            </span>
          )}
          <input
            {...rest}
            {...control}
            autoComplete={autoComplete}
            className={cx(styles.input, mono && styles.mono, prefix && styles.withPrefix)}
          />
        </div>
      )}
    </Field>
  )
}

type TextAreaProps = Omit<ComponentPropsWithRef<'textarea'>, 'id'> &
  FieldOwnProps &
  CounterProps & { mono?: boolean }

export function TextArea({
  label,
  hint,
  error,
  hideLabel,
  maxChars,
  mono,
  className,
  rows = 3,
  'aria-describedby': ownDescribedBy,
  ...rest
}: TextAreaProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      aria-describedby={ownDescribedBy}
      counter={counterOf(rest.value, maxChars)}
      className={className}
    >
      {(control) => (
        <textarea
          {...rest}
          {...control}
          rows={rows}
          className={cx(styles.input, styles.textarea, mono && styles.mono)}
        />
      )}
    </Field>
  )
}

type SelectProps = Omit<ComponentPropsWithRef<'select'>, 'id'> & FieldOwnProps

export function Select({
  label,
  hint,
  error,
  hideLabel,
  className,
  children,
  'aria-describedby': ownDescribedBy,
  ...rest
}: SelectProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      aria-describedby={ownDescribedBy}
      className={className}
    >
      {(control) => (
        <div className={styles.selectBox}>
          <select {...rest} {...control} className={cx(styles.input, styles.select)}>
            {children}
          </select>
        </div>
      )}
    </Field>
  )
}

type CheckboxProps = Omit<ComponentPropsWithRef<'input'>, 'id' | 'type'> & {
  label: ReactNode
  hint?: ReactNode
  error?: string | undefined
}

/** Флажок: нативный input, вся подпись нажимается */
export function Checkbox({
  label,
  hint,
  error,
  className,
  'aria-describedby': ownDescribedBy,
  ...rest
}: CheckboxProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [ownDescribedBy, hint && hintId, error && errorId].filter(Boolean).join(' ')
  return (
    <div className={cx(styles.checkbox, className)}>
      <div className={styles.checkboxRow}>
        <input
          {...rest}
          id={id}
          type="checkbox"
          className={styles.checkboxInput}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
        />
        <label htmlFor={id} className={styles.checkboxLabel}>
          {label}
        </label>
      </div>
      {hint && (
        <p id={hintId} className={cx(styles.hint, styles.checkboxNote)}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={cx(styles.error, styles.checkboxNote)}>
          {error}
        </p>
      )}
    </div>
  )
}
