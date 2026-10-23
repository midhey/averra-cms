import type { BlockType } from '@averra/schema'
import { cx } from '../ui/cx'
import styles from './BlockSketch.module.scss'

/** Деталь наброска: полоса (строка текста) или плашка (картинка, карточка, кнопка) */
type Part = {
  kind: 'bar' | 'box'
  /** Ширина: доля наброска («45%») или размер в rem */
  width: string
  /** Высота в пикселях макета — переводится в rem */
  height: number
  /** light — фон и текст, dark — заголовок и главное, accent — кнопка и акцент */
  tone: 'light' | 'dark' | 'accent'
}

type Sketch = { direction: 'row' | 'column'; parts: readonly Part[] }

const bar = (width: string, height: number, tone: Part['tone'] = 'light'): Part => ({
  kind: 'bar',
  width,
  height,
  tone,
})
const box = (width: string, height: number, tone: Part['tone'] = 'light'): Part => ({
  kind: 'box',
  width,
  height,
  tone,
})
const repeat = (count: number, part: Part) => Array.from({ length: count }, () => part)

/**
 * Наброски блоков для каталога — по концепту Catalog.dc.html. Набор полный: блок без наброска не
 * скомпилируется (satisfies Record<BlockType, …>)
 */
const sketches = {
  hero: { direction: 'row', parts: [bar('45%', 30, 'dark'), box('35%', 60)] },
  'text-image': { direction: 'row', parts: [box('40%', 60), bar('45%', 40)] },
  features: { direction: 'row', parts: repeat(3, box('28%', 44)) },
  stats: { direction: 'row', parts: repeat(3, bar('24%', 26, 'dark')) },
  steps: {
    direction: 'row',
    parts: [
      box('1.125rem', 18, 'accent'),
      bar('16%', 3),
      box('1.125rem', 18, 'accent'),
      bar('16%', 3),
      box('1.125rem', 18, 'accent'),
    ],
  },
  pricing: { direction: 'row', parts: [box('26%', 64), box('28%', 72, 'dark'), box('26%', 64)] },
  faq: { direction: 'column', parts: [bar('90%', 12, 'dark'), ...repeat(3, bar('90%', 12))] },
  cta: { direction: 'column', parts: [box('100%', 46, 'accent')] },
  form: { direction: 'column', parts: [bar('70%', 12), bar('70%', 12), bar('40%', 16, 'accent')] },
  video: { direction: 'column', parts: [box('70%', 60, 'dark')] },
  text: {
    direction: 'column',
    parts: [bar('50%', 12, 'dark'), bar('90%', 6), bar('90%', 6), bar('70%', 6)],
  },
} as const satisfies Record<BlockType, Sketch>

/** Набросок блока: рисунок, а не содержание — скрыт от диктора, смысл несут название и описание */
export function BlockSketch({ type, className }: { type: BlockType; className?: string }) {
  const sketch: Sketch = sketches[type]
  return (
    <span className={cx(styles.sketch, styles[sketch.direction], className)} aria-hidden="true">
      {sketch.parts.map((part, index) => (
        <span
          // Набросок статичен, детали не переставляются: ключ по месту
          key={index}
          className={cx(styles[part.kind], styles[part.tone])}
          // Размеры — данные наброска, а не оформление: у каждой детали свои
          style={{ width: part.width, height: `${part.height / 16}rem` }}
        />
      ))}
    </span>
  )
}
