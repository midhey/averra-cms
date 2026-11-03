import { type CSSProperties, type Key, type ReactNode, useEffect, useRef, useState } from 'react'
import { cx } from './cx'
import styles from './DataTable.module.scss'

export type Column<Row> = {
  key: string
  header: ReactNode
  cell: (row: Row) => ReactNode
  /** Моноширинный шрифт: адреса, версии, id */
  mono?: boolean
  /** Приглушённый текст: даты, второстепенное */
  muted?: boolean
  align?: 'start' | 'end'
  /**
   * Перенос текста в ячейках. По умолчанию слово не рвётся. anywhere — для длинных строк без
   * пробелов (заголовок, адрес страницы), чтобы они не растягивали таблицу; nowrap — для почты,
   * роли, дат и кнопок, которые нельзя разрывать
   */
  wrap?: 'anywhere' | 'nowrap'
  /** Ширина колонки (%, rem) — для таблицы с fixed: остаток делят колонки без ширины */
  width?: string
  /**
   * Наименьшая ширина колонки (rem): с wrap anywhere длинная почта сжимается, а обычная не рвётся
   * на буквы. Задаётся заголовку, ячейки следуют за ним
   */
  minWidth?: string
  /**
   * Колонка прижата к правому краю рамки и не уезжает при прокрутке вбок: действия строки
   * («Отозвать», «Удалить») всегда на виду. Годится последней колонке
   */
  pinned?: boolean
  /**
   * Подпись значения в карточке на телефоне. По умолчанию — заголовок, если он строка; у
   * колонки без подписи (действия) значение стоит без неё
   */
  label?: string
}

/**
 * Есть ли справа ещё не показанные колонки. Нужно прижатой колонке действий: её тень (CSS не
 * знает, прокручивается ли область) рисуется, только когда под ней что-то спрятано
 */
function useMoreAtEnd(shown: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    // Область появляется не сразу: пока строк нет, вместо неё показан empty
    const el = ref.current
    if (!shown || !el) return
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    observer?.observe(el)
    if (el.firstElementChild) observer?.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [shown])
  return [ref, more] as const
}

/**
 * Явные роли таблицы. На телефоне у table, tbody, tr и td меняется display (строка — карточка), а
 * Safari с VoiceOver при display: block/flex теряет семантику таблицы: заголовки колонок и связь
 * ячеек с ними. Роль возвращает её. Подставляются распространением, а не атрибутом: для обычных
 * элементов линтер счёл бы роль лишней, а здесь она нужна именно из-за CSS
 */
const tableRoles = {
  table: { role: 'table' },
  rowgroup: { role: 'rowgroup' },
  row: { role: 'row' },
  columnheader: { role: 'columnheader' },
  rowheader: { role: 'rowheader' },
  cell: { role: 'cell' },
} as const

/** Подпись значения в карточке: свой label, иначе заголовок-строка */
const labelOf = <Row,>(column: Column<Row>) =>
  column.label ?? (typeof column.header === 'string' ? column.header : undefined)

type DataTableProps<Row> = {
  /** Что в таблице: подпись таблицы и области прокрутки для диктора */
  caption: string
  /** Показать подпись над таблицей; по умолчанию её видит только диктор (рядом есть заголовок) */
  showCaption?: boolean
  columns: ReadonlyArray<Column<Row>>
  rows: ReadonlyArray<Row>
  rowKey: (row: Row) => Key
  /** Что показать вместо пустой таблицы */
  empty?: ReactNode
  /** Ширина, уже которой таблица не сжимается, а прокручивается по горизонтали */
  minWidth?: string
  /**
   * fixed — колонки по заданным ширинам, а не по содержимому: длинная строка переносится внутри
   * своей колонки и не раздвигает таблицу шире рамки (очередь писем)
   */
  layout?: 'auto' | 'fixed'
  /** Плотная: меньше поля у ячеек — для таблиц с 5–6 колонками (приглашения) */
  compact?: boolean
}

/**
 * Таблица: колонки описываются данными, первая ячейка строки — её заголовок (th scope="row").
 * Шире 40rem прокручивается внутри своей рамки (край с продолжением подсвечен, действия
 * прижаты), а не всей страницей; область прокрутки (группа с подписью) в порядке Tab — её можно
 * листать стрелками. На телефоне строка — карточка: название, затем «подпись: значение» и действия
 */
export function DataTable<Row>({
  caption,
  showCaption = false,
  columns,
  rows,
  rowKey,
  empty,
  minWidth = '40rem',
  layout = 'auto',
  compact = false,
}: DataTableProps<Row>) {
  const [scrollerRef, more] = useMoreAtEnd(!(rows.length === 0 && empty))
  if (rows.length === 0 && empty) return <div className={styles.frame}>{empty}</div>
  return (
    // Группа, а не region: таблица стоит в разделе экрана с тем же именем, и два ориентира
    // «Страницы» подряд диктору только мешали бы. Подпись нужна: область в порядке Tab
    // biome-ignore lint/a11y/useSemanticElements: fieldset — для полей формы, здесь область прокрутки таблицы
    <div
      role="group"
      className={cx(styles.frame, styles.scroller)}
      aria-label={caption}
      ref={scrollerRef}
      data-more={more || undefined}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: прокручиваемая область должна быть доступна с клавиатуры
      tabIndex={0}
    >
      <table
        {...tableRoles.table}
        className={cx(styles.table, layout === 'fixed' && styles.fixed, compact && styles.compact)}
        style={{ '--table-min-width': minWidth } as CSSProperties}
      >
        <caption className={showCaption ? styles.caption : 'visually-hidden'}>{caption}</caption>
        {columns.some((column) => column.width) && (
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={column.width ? { width: column.width } : undefined} />
            ))}
          </colgroup>
        )}
        <thead {...tableRoles.rowgroup}>
          <tr {...tableRoles.row}>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                {...tableRoles.columnheader}
                className={cx(column.align === 'end' && styles.end, column.pinned && styles.pinned)}
                style={column.minWidth ? { minWidth: column.minWidth } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody {...tableRoles.rowgroup}>
          {rows.map((row) => (
            <tr key={rowKey(row)} {...tableRoles.row}>
              {columns.map((column, index) => {
                const className = cx(
                  column.mono && styles.mono,
                  column.muted && styles.muted,
                  column.align === 'end' && styles.end,
                  column.wrap === 'anywhere' && styles.wrapAnywhere,
                  column.wrap === 'nowrap' && styles.nowrap,
                  column.pinned && styles.pinned,
                )
                return index === 0 ? (
                  <th
                    key={column.key}
                    scope="row"
                    {...tableRoles.rowheader}
                    className={cx(styles.rowHeader, className)}
                  >
                    {column.cell(row)}
                  </th>
                ) : (
                  <td
                    key={column.key}
                    {...tableRoles.cell}
                    className={className}
                    data-label={labelOf(column)}
                  >
                    {column.cell(row)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
