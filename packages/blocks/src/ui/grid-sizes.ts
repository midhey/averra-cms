/** Ширина контейнера страницы (--container в @averra/tokens), rem */
const CONTAINER_REM = 72

/**
 * Атрибут sizes для картинок в сетке — по тем же точкам перелома и числу колонок, что в CSS
 * блока. Иначе браузер выберет вариант мельче колонки (размытие) или крупнее (лишний вес).
 * narrow — колонок на телефоне; steps — [от какой ширины экрана в rem, сколько колонок] по
 * возрастанию. Шире контейнера колонка — его доля в rem, до него — доля экрана в vw
 */
export function gridSizes(narrow: number, steps: ReadonlyArray<readonly [number, number]> = []) {
  const parts: string[] = []
  let columns = narrow
  const ranges: Array<[number, number]> = []
  for (const [min, count] of steps) {
    // Число колонок не изменилось — точка перелома для картинки ничего не меняет
    if (count !== columns) ranges.push([min, count])
    columns = count
  }
  parts.push(`(min-width: ${CONTAINER_REM}rem) ${round(CONTAINER_REM / columns)}rem`)
  for (const [min, count] of ranges.reverse()) {
    parts.push(`(min-width: ${min}rem) ${round(100 / count)}vw`)
  }
  parts.push(`${round(100 / narrow)}vw`)
  return parts.join(', ')
}

const round = (value: number) => Math.round(value * 10) / 10
