import { REDIRECTS_MAX } from '@averra/schema'
import { useRef } from 'react'
import { Button, IconButton } from '../ui/Button'
import { TextInput } from '../ui/Field'
import styles from './RedirectRows.module.scss'
import type { RedirectRow } from './seo-format'

type RedirectRowsProps = {
  rows: readonly RedirectRow[]
  /** Имена полей строки: по ним форма находит поле с ошибкой (redirects.2.from) */
  names: (row: RedirectRow, index: number) => { from: string; to: string }
  error: (name: string) => string | undefined
  /** Предупреждение у «откуда»: например, по адресу уже есть страница */
  warning?: (row: RedirectRow) => string | undefined
  onChange: (key: string, part: 'from' | 'to', value: string) => void
  onRemove: (key: string, index: number) => void
  onAdd: () => void
}

/**
 * Таблица редиректов «откуда → куда» строками полей. Подписи у каждого поля видны: строк немного,
 * а на телефоне колонок нет. Удаление — у строки, с номером для диктора. Кнопка удаления пропадает
 * вместе со строкой — фокус переходит на «Добавить редирект», а не теряется
 */
export function RedirectRows({
  rows,
  names,
  error,
  warning,
  onChange,
  onRemove,
  onAdd,
}: RedirectRowsProps) {
  const full = rows.length >= REDIRECTS_MAX
  const addRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      {rows.length === 0 ? (
        <p className={styles.empty}>Редиректов нет.</p>
      ) : (
        <ol className={styles.list} aria-label="Редиректы">
          {rows.map((row, index) => {
            const name = names(row, index)
            return (
              <li key={row.key} className={styles.row}>
                <TextInput
                  className={styles.from}
                  label="Откуда"
                  name={name.from}
                  mono
                  value={row.from}
                  placeholder="/old-page"
                  onChange={(event) => onChange(row.key, 'from', event.target.value)}
                  error={error(name.from)}
                  hint={warning?.(row)}
                />
                <TextInput
                  className={styles.to}
                  label="Куда"
                  name={name.to}
                  mono
                  value={row.to}
                  placeholder="/new-page или https://…"
                  onChange={(event) => onChange(row.key, 'to', event.target.value)}
                  error={error(name.to)}
                />
                <IconButton
                  className={styles.remove}
                  label={`Удалить редирект ${index + 1}${row.from ? ` с ${row.from}` : ''}`}
                  icon="trash"
                  onClick={() => {
                    onRemove(row.key, index)
                    addRef.current?.focus()
                  }}
                />
              </li>
            )
          })}
        </ol>
      )}
      <div>
        <Button ref={addRef} icon="plus" size="small" disabled={full} onClick={onAdd}>
          Добавить редирект
        </Button>
      </div>
    </>
  )
}
