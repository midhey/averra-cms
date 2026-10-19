import { BlockId } from '@averra/schema'

/**
 * Цвета подсветки — значения ролей темы админки (`--color-action`, `--color-border-strong`),
 * прочитанные из её документа: глобальный слой админки в iframe не попадает (шаг 3.8), а сырых
 * цветов в коде нет
 */
export type SelectionColors = { selection: string; hover: string }

/** Селектор блока в предпросмотре: Page рисует каждый блок корневым <section id> внутри <main> */
export const PREVIEW_BLOCK_SELECTOR = 'main > section[id]'

// В значение custom property не должно попасть ничего, что закроет правило
const safeValue = (value: string) =>
  /^[^;{}<>]+$/.test(value.trim()) ? value.trim() : 'currentcolor'

type SelectionCss = {
  /** Выбранный блок или null */
  selectedId: string | null
  /** Масштаб предпросмотра: ужатый «десктоп» не должен терять рамку */
  scale: number
  colors: SelectionColors
  /** false — в предпросмотре версия из истории: выбирать в ней нечего */
  interactive: boolean
}

/**
 * CSS подсветки для iframe предпросмотра: рамка внутрь у выбранного блока, пунктир при наведении
 * у остальных. На опубликованный сайт ничего из этого не попадает. Id в селектор идёт, только
 * если проходит BlockId (латиница, цифры, _ и -): экранировать нечего
 */
export function previewSelectionCss({ selectedId, scale, colors, interactive }: SelectionCss) {
  if (!interactive) return ''
  const width = `${Number((2 / Math.max(scale, 0.1)).toFixed(2))}px`
  const rules = [
    `:root { --averra-selection: ${safeValue(colors.selection)}; --averra-hover: ${safeValue(colors.hover)}; --averra-outline: ${width}; }`,
    `${PREVIEW_BLOCK_SELECTOR} { cursor: pointer; }`,
    `${PREVIEW_BLOCK_SELECTOR}:hover { outline: calc(var(--averra-outline) / 2) dashed var(--averra-hover); outline-offset: calc(var(--averra-outline) / -2); }`,
  ]
  if (selectedId !== null && BlockId.safeParse(selectedId).success) {
    const selected = `main > section[id="${selectedId}"]`
    rules.push(
      `${selected}, ${selected}:hover { outline: var(--averra-outline) solid var(--averra-selection); outline-offset: calc(var(--averra-outline) * -1); }`,
    )
  }
  return rules.join('\n')
}

/** Какой блок под щелчком в предпросмотре: id ближайшего блока, если он есть среди блоков */
export function blockIdAt(target: EventTarget | null, ids: ReadonlySet<string>) {
  // Element из iframe — другого окна, instanceof Element с ним не сработает: смотрим на closest
  const element = target as { closest?: (selector: string) => { id: string } | null } | null
  const section =
    typeof element?.closest === 'function' ? element.closest(PREVIEW_BLOCK_SELECTOR) : null
  return section && ids.has(section.id) ? section.id : null
}
