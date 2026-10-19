import { type ReactNode, useId } from 'react'
import { cx } from './cx'
import styles from './SegmentedControl.module.scss'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  /** Миниатюра варианта (вид «карточки»): схема блока над подписью */
  thumbnail?: ReactNode
}

type SegmentedControlProps<T extends string> = {
  legend: string
  /** Подпись группы только для диктора: рядом и так понятно, что выбирают */
  hideLegend?: boolean
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  /** segments — плотная дорожка (ширина предпросмотра), cards — карточки с миниатюрами */
  appearance?: 'segments' | 'cards'
  disabled?: boolean
}

/**
 * Выбор одного из нескольких: нативные радиокнопки в fieldset. Tab заходит в группу один раз,
 * стрелки меняют выбор — как у браузера, без своих обработчиков
 */
export function SegmentedControl<T extends string>({
  legend,
  hideLegend,
  options,
  value,
  onChange,
  appearance = 'segments',
  disabled,
}: SegmentedControlProps<T>) {
  const name = useId()
  return (
    <fieldset className={cx(styles.group, styles[appearance])} disabled={disabled}>
      <legend className={cx(styles.legend, hideLegend && 'visually-hidden')}>{legend}</legend>
      <div className={styles.options}>
        {options.map((option) => (
          <label key={option.value} className={styles.option}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className={styles.input}
            />
            {option.thumbnail && (
              <span className={styles.thumbnail} aria-hidden="true">
                {option.thumbnail}
              </span>
            )}
            <span className={styles.label}>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Схематичная миниатюра блока для вида «карточки»: строки текста и, если нужно, картинка */
export function LayoutThumbnail({ media = false }: { media?: boolean }) {
  return (
    <span className={styles.sketch}>
      <span className={styles.sketchLines}>
        <span className={styles.sketchLine} />
        <span className={cx(styles.sketchLine, styles.sketchLineShort)} />
      </span>
      {media && <span className={styles.sketchMedia} />}
    </span>
  )
}
