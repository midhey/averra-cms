import type { EnumSketch } from '@averra/schema'
import { type ReactNode, useId } from 'react'
import { cx } from './cx'
import styles from './SegmentedControl.module.scss'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  /** Миниатюра варианта (вид «карточки»): схема блока над подписью */
  thumbnail?: ReactNode
  /** Пояснение под подписью (вид «список»): чем вариант отличается от соседних */
  description?: ReactNode
}

type SegmentedControlProps<T extends string> = {
  legend: string
  /** Подпись группы только для диктора: рядом и так понятно, что выбирают */
  hideLegend?: boolean
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  /**
   * segments — плотная дорожка (ширина предпросмотра), cards — карточки с миниатюрами,
   * list — карточки в столбик с пояснением (режим cookie-уведомления), chips — пилюли
   * с переносом строк (разделы каталога блоков: вариантов много, подписи разной длины)
   */
  appearance?: 'segments' | 'cards' | 'list' | 'chips'
  disabled?: boolean
  /** Карточки растягиваются на всю ширину: вариантов мало, подписи длинные (вид cookie) */
  fill?: boolean
  /**
   * Дорожка в узкой колонке переносится сеткой 2×2, а не режет подписи многоточием: варианты
   * с длинными подписями («Средние», «Большие») на телефоне иначе не прочитать
   */
  wrap?: boolean
  /** Имя радиокнопок в форме: по нему focusField ставит фокус на группу с ошибкой */
  name?: string
  /** Описания группы (ошибка, подсказка рядом): диктор прочитает их, войдя в группу */
  'aria-describedby'?: string | undefined
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
  fill,
  wrap,
  name: formName,
  'aria-describedby': describedBy,
}: SegmentedControlProps<T>) {
  const ownName = useId()
  const name = formName ?? ownName
  return (
    <fieldset
      className={cx(styles.group, styles[appearance], fill && styles.fill, wrap && styles.wrap)}
      disabled={disabled}
      aria-describedby={describedBy}
    >
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
            {option.description && <span className={styles.description}>{option.description}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * Схематичная миниатюра варианта блока для вида «карточки»: строки текста по центру или слева
 * и, у варианта с картинкой, картинка справа. Имена рисунков — из пометки x-enum-sketches схемы
 */
export function LayoutThumbnail({ sketch = 'left' }: { sketch?: EnumSketch }) {
  // Картинка рядом с текстом: справа у первого экрана «С картинкой» и у «Текста с картинкой»
  // справа, слева — у «Текста с картинкой» слева
  const media = sketch === 'split' || sketch === 'image-right' || sketch === 'image-left'
  return (
    <span className={cx(styles.sketch, sketch === 'image-left' && styles.sketchMediaFirst)}>
      <span className={cx(styles.sketchLines, sketch === 'centered' && styles.sketchCentered)}>
        <span className={styles.sketchLine} />
        <span className={cx(styles.sketchLine, styles.sketchLineShort)} />
      </span>
      {media && <span className={styles.sketchMedia} />}
    </span>
  )
}
