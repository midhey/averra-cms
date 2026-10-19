import type { Key, ReactNode } from 'react'
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
}

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
}

/**
 * Таблица: колонки описываются данными, первая ячейка строки — её заголовок (th scope="row").
 * На узком экране прокручивается внутри своей рамки, а не всей страницей; область прокрутки
 * (группа с подписью) в порядке Tab — её можно листать стрелками с клавиатуры
 */
export function DataTable<Row>({
  caption,
  showCaption = false,
  columns,
  rows,
  rowKey,
  empty,
  minWidth = '40rem',
}: DataTableProps<Row>) {
  if (rows.length === 0 && empty) return <div className={styles.frame}>{empty}</div>
  return (
    // Группа, а не region: таблица стоит в разделе экрана с тем же именем, и два ориентира
    // «Страницы» подряд диктору только мешали бы. Подпись нужна: область в порядке Tab
    // biome-ignore lint/a11y/useSemanticElements: fieldset — для полей формы, здесь область прокрутки таблицы
    <div
      role="group"
      className={cx(styles.frame, styles.scroller)}
      aria-label={caption}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: прокручиваемая область должна быть доступна с клавиатуры
      tabIndex={0}
    >
      <table className={styles.table} style={{ minWidth }}>
        <caption className={showCaption ? styles.caption : 'visually-hidden'}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cx(column.align === 'end' && styles.end)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column, index) => {
                const className = cx(
                  column.mono && styles.mono,
                  column.muted && styles.muted,
                  column.align === 'end' && styles.end,
                  column.wrap === 'anywhere' && styles.wrapAnywhere,
                  column.wrap === 'nowrap' && styles.nowrap,
                )
                return index === 0 ? (
                  <th key={column.key} scope="row" className={cx(styles.rowHeader, className)}>
                    {column.cell(row)}
                  </th>
                ) : (
                  <td key={column.key} className={className}>
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
