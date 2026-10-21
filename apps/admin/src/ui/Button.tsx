import type { ComponentPropsWithRef, ReactNode } from 'react'
import styles from './Button.module.scss'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'medium' | 'small'

type Look = { variant?: ButtonVariant | undefined; size?: ButtonSize | undefined }

/** Вид кнопки для ссылки (Link роутера, mailto): «Новая страница», «Ответить письмом» */
export function buttonClassName({ variant = 'secondary', size = 'medium' }: Look = {}) {
  return cx(styles.button, styles[variant], size === 'small' && styles.small)
}

type ButtonProps = ComponentPropsWithRef<'button'> &
  Look & {
    /**
     * Идёт действие этой кнопки: она остаётся в фокусе и в порядке Tab, но нажатие не
     * срабатывает (`aria-disabled`), диктор слышит «занято» (`aria-busy`), вместо иконки — спиннер
     */
    loading?: boolean
    /** Иконка перед подписью */
    icon?: IconName
  }

/** Кнопка. По умолчанию `type="button"`: отправку формы объявляют явно (`type="submit"`) */
export function Button({
  variant,
  size,
  loading = false,
  icon,
  type = 'button',
  className,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx(buttonClassName({ variant, size }), className)}
      aria-busy={loading || undefined}
      aria-disabled={loading || rest['aria-disabled'] || undefined}
      onClick={(event) => {
        if (loading) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
    >
      {loading ? <Spinner /> : icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

/** Крутилка «идёт действие». Без движения при prefers-reduced-motion */
export function Spinner() {
  return <span className={styles.spinner} aria-hidden="true" />
}

/** Вид кнопки-иконки для ссылки (Link роутера): «Назад к сайту». Подпись — aria-label у ссылки */
export function iconButtonClassName({
  variant = 'ghost',
  size = 'medium',
}: {
  variant?: 'secondary' | 'ghost' | undefined
  size?: ButtonSize | undefined
} = {}) {
  return cx(buttonClassName({ variant, size }), styles.iconOnly)
}

type IconButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children' | 'aria-label'> & {
  /** Что делает кнопка: становится aria-label и подсказкой при наведении. Без неё кнопки нет */
  label: string
  icon: IconName
  variant?: 'secondary' | 'ghost' | undefined
  size?: ButtonSize | undefined
  /**
   * Значок в углу кнопки (CountBadge): «3 совета» у «SEO». Число должно быть и в label — значок
   * для диктора скрыт
   */
  badge?: ReactNode
}

/** Кнопка-иконка без видимой подписи: «Закрыть», «Меню», «Назад к сайту» */
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size,
  type = 'button',
  className,
  badge,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        iconButtonClassName({ variant, size }),
        badge ? styles.withBadge : undefined,
        className,
      )}
      {...rest}
    >
      <Icon name={icon} />
      {badge && <span className={styles.badge}>{badge}</span>}
    </button>
  )
}
