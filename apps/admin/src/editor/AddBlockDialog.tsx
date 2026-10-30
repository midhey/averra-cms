import { useEffect, useRef, useState } from 'react'
import { countRu } from '../format/plural'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { EmptyState } from '../ui/EmptyState'
import { TextInput } from '../ui/Field'
import { SegmentedControl } from '../ui/SegmentedControl'
import { StatusPill } from '../ui/StatusPill'
import styles from './AddBlockDialog.module.scss'
import { BlockSketch } from './BlockSketch'
import {
  type CatalogEntry,
  type CatalogSection,
  catalog,
  filterCatalog,
  sectionsFor,
  sectionTitle,
} from './catalog'

/** Есть мышь: фокус в поиск при открытии. На телефоне клавиатура закрыла бы половину каталога */
const FINE_POINTER = '(pointer: fine)'

type AddBlockDialogProps = {
  open: boolean
  onClose: () => void
  /** Тип блока: встроенного (hero) или своего (custom:tariffs) */
  onPick: (type: string) => void
  /** Куда встанет блок: после выбранного (его имя) или в конец страницы */
  after: string | null
  /** Блоки каталога: редактор — встроенные и свои блоки сайта, витрина — свои примеры */
  entries?: readonly CatalogEntry[]
}

/**
 * Каталог блоков в окне: поиск, разделы и карточки с наброском, названием и описанием. Выбор —
 * обычная кнопка: Tab и Enter; разделы — радиокнопки (стрелки); Esc закрывает, по закрытии
 * браузер возвращает фокус на «Добавить блок»
 */
export function AddBlockDialog({
  open,
  onClose,
  onPick,
  after,
  entries = catalog,
}: AddBlockDialogProps) {
  const [query, setQuery] = useState('')
  const [section, setSection] = useState<CatalogSection>('all')
  const searchRef = useRef<HTMLInputElement>(null)
  const found = filterCatalog(entries, section, query)
  const filtered = query.trim() !== '' || section !== 'all'

  // Каждое открытие — с чистого листа. Эффект родителя идёт после эффекта Dialog, поэтому
  // окно уже открыто showModal() и поле можно сфокусировать
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSection('all')
    if (window.matchMedia?.(FINE_POINTER).matches) searchRef.current?.focus()
  }, [open])

  const showAll = () => {
    setQuery('')
    setSection('all')
    searchRef.current?.focus()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="wide"
      title="Добавить блок"
      description={
        after === null ? 'Блок встанет в конец страницы.' : `Блок встанет после «${after}».`
      }
    >
      <div className={styles.toolbar}>
        <TextInput
          ref={searchRef}
          type="search"
          label="Найти блок"
          hideLabel
          placeholder="Найти блок"
          icon="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={styles.search}
        />
        <SegmentedControl
          legend="Раздел каталога"
          hideLegend
          appearance="chips"
          options={sectionsFor(entries).map((value) => ({
            value,
            label: value === 'all' ? `Все · ${entries.length}` : sectionTitle(value),
          }))}
          value={section}
          onChange={setSection}
        />
      </div>
      {/* Итог фильтра для диктора: зрячий видит карточки, незрячему нужно число */}
      <p role="status" className="visually-hidden">
        {filtered ? `Найдено: ${countRu(found.length, ['блок', 'блока', 'блоков'])}` : ''}
      </p>
      {found.length > 0 ? (
        <ul className={styles.list} aria-label="Каталог блоков">
          {found.map((entry) => (
            <li key={entry.type}>
              <button type="button" className={styles.option} onClick={() => onPick(entry.type)}>
                <BlockSketch sketch={entry.sketch} className={styles.sketch} />
                <span className={styles.text}>
                  <span className={styles.heading}>
                    <span className={styles.title}>{entry.title}</span>
                    {entry.isNew && <StatusPill tone="info">новый</StatusPill>}
                    {entry.custom && <StatusPill tone="neutral">свой</StatusPill>}
                  </span>
                  <span className={styles.description}>{entry.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="Такого блока нет"
          icon="search"
          headingLevel={3}
          action={<Button onClick={showAll}>Показать все блоки</Button>}
        >
          Попробуйте другое слово или раздел «Все».
        </EmptyState>
      )}
    </Dialog>
  )
}
