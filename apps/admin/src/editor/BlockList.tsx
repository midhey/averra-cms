import type { BlockType } from '@cms/schema'
import { useState } from 'react'
import styles from './BlockList.module.css'
import { catalog, catalogEntry } from './catalog'
import type { EditorBlock } from './draft'

type BlockListProps = {
  blocks: readonly EditorBlock[]
  selectedId: string | null
  invalidIds: ReadonlySet<string>
  onSelect: (id: string) => void
  onMove: (id: string, offset: -1 | 1) => void
  onRemove: (id: string) => void
  onAdd: (type: BlockType) => void
}

export function BlockList(props: BlockListProps) {
  const { blocks, selectedId, invalidIds, onSelect, onMove, onRemove, onAdd } = props
  const [newType, setNewType] = useState<BlockType>(catalog[0]?.type ?? 'hero')

  const remove = (block: EditorBlock) => {
    if (window.confirm(`Удалить блок «${summaryOf(block)}»?`)) onRemove(block.id)
  }

  return (
    <nav className={styles.panel} aria-label="Блоки страницы">
      <ol className={styles.list}>
        {blocks.map((block, index) => (
          <li key={block.id} className={styles.item} data-selected={block.id === selectedId}>
            <button type="button" className={styles.select} onClick={() => onSelect(block.id)}>
              <span className={styles.type}>
                {catalogEntry(block.type).title}
                {invalidIds.has(block.id) && <span className={styles.badge}>ошибка</span>}
              </span>
              <span className={styles.summary}>{summaryOf(block)}</span>
            </button>
            <div className={styles.actions}>
              <button
                type="button"
                aria-label="Поднять блок"
                disabled={index === 0}
                onClick={() => onMove(block.id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Опустить блок"
                disabled={index === blocks.length - 1}
                onClick={() => onMove(block.id, 1)}
              >
                ↓
              </button>
              <button type="button" aria-label="Удалить блок" onClick={() => remove(block)}>
                ✕
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className={styles.add}>
        <select
          aria-label="Тип нового блока"
          value={newType}
          onChange={(event) => {
            const picked = catalog.find((entry) => entry.type === event.target.value)
            if (picked) setNewType(picked.type)
          }}
        >
          {catalog.map((entry) => (
            <option key={entry.type} value={entry.type}>
              {entry.title}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onAdd(newType)}>
          + Добавить
        </button>
      </div>
    </nav>
  )
}

/** Подпись блока в списке: его заголовок, если он есть, иначе id */
function summaryOf(block: EditorBlock) {
  const title = block.props.title
  return typeof title === 'string' && title !== '' ? title : `#${block.id}`
}
