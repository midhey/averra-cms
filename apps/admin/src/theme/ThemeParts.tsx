import type { ContrastCheck, Theme, ThemeColorRole } from '@averra/schema'
import type { CSSProperties } from 'react'
import { TextInput } from '../ui/Field'
import { StatusPill } from '../ui/StatusPill'
import styles from './ThemeParts.module.scss'
import { contrastText, contrastTone } from './theme-format'

/**
 * Отметка контраста пары: «7,1 · ок» или «2,8 · мало». Смысл несёт текст, цвет помогает; диктор
 * слышит и какая пара, и сколько нужно
 */
export function ContrastBadge({ check }: { check: ContrastCheck }) {
  return (
    <StatusPill tone={contrastTone(check)} className={styles.badge}>
      <span className="visually-hidden">
        {check.label}, нужно не меньше {String(check.min).replace('.', ',')}:{' '}
      </span>
      {contrastText(check)}
    </StatusPill>
  )
}

type ColorRowProps = {
  colorRole: ThemeColorRole
  title: string
  /** Как набрали в поле: может быть недописан */
  value: string
  /** Последний дописанный цвет: его показывает палитра, пока в поле набирают новый */
  swatch: string
  check: ContrastCheck | undefined
  error: string | undefined
  disabled: boolean
  onChange: (value: string) => void
}

/**
 * Цвет темы: палитра браузера (в Chrome и Edge в ней есть пипетка) и поле #RRGGBB рядом. Отметка
 * контраста — у главной пары этого цвета; у линий её нет: они декоративные
 */
export function ColorRow({
  colorRole,
  title,
  value,
  swatch,
  check,
  error,
  disabled,
  onChange,
}: ColorRowProps) {
  return (
    <div className={styles.colorRow}>
      {/* Подпись — над всей строкой: палитра, поле и отметка встают в ряд по верху и не
          разъезжаются, когда под полем появляется ошибка. Для диктора подпись у самого поля */}
      <span className={styles.title} aria-hidden="true">
        {title}
      </span>
      <div className={styles.colorGrid}>
        <label className={styles.picker}>
          <span className="visually-hidden">{title}: палитра</span>
          <input
            type="color"
            value={swatch}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className={styles.pickerInput}
          />
        </label>
        <TextInput
          label={title}
          hideLabel
          name={`colors.${colorRole}`}
          value={value}
          mono
          spellCheck={false}
          maxLength={7}
          disabled={disabled}
          error={error}
          onChange={(event) => onChange(event.target.value)}
          className={styles.hex}
        />
        <span className={styles.check}>
          {check ? (
            <ContrastBadge check={check} />
          ) : (
            <span className={styles.noCheck}>{colorRole === 'border' ? 'без проверки' : '—'}</span>
          )}
        </span>
      </div>
    </div>
  )
}

/**
 * Миниатюра готовой темы: её фон, точка акцента и полоса текста. Цвета — содержимое (цвета темы
 * сайта), а не оформление админки, поэтому приходят переменными из данных
 */
export function ThemeSwatch({ theme }: { theme: Theme }) {
  const style = {
    '--swatch-background': theme.colors.background,
    '--swatch-accent': theme.colors.accent,
    '--swatch-text': theme.colors.text,
    '--swatch-border': theme.colors.border,
  } as CSSProperties
  return (
    <span className={styles.swatch} style={style}>
      <span className={styles.swatchDot} />
      <span className={styles.swatchLine} />
    </span>
  )
}
