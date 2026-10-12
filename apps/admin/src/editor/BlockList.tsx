import type { BlockType } from '@cms/schema'
import { useMemo, useState } from 'react'
import { DragHandle, SortableList, useSortableItem } from '../ui/SortableList'
import { useMoveButtons } from '../ui/use-move-buttons'
import styles from './BlockList.module.css'
import { catalog, catalogEntry } from './catalog'
import type { EditorBlock } from './draft'

type BlockListProps = {
  blocks: readonly EditorBlock[]
  selectedId: string | null
  invalidIds: ReadonlySet<string>
  onSelect: (id: string) => void
  /** Перестановка и стрелками, и перетаскиванием: блок с места from встаёт на место to */
  onMove: (from: number, to: number) => void
  onRemove: (id: string) => void
  onAdd: (type: BlockType) => void
}

export function BlockList(props: BlockListProps) {
  const { blocks, selectedId, invalidIds, onSelect, onMove, onRemove, onAdd } = props
  const [newType, setNewType] = useState<BlockType>(catalog[0]?.type ?? 'hero')
  const entries = useMemo(
    () => blocks.map((block) => ({ id: block.id, label: summaryOf(block) })),
    [blocks],
  )

  return (
    <nav className={styles.panel} aria-label="Блоки страницы">
      <SortableList entries={entries} noun="блок" onMove={onMove}>
        <ol className={styles.list}>
          {blocks.map((block, index) => (
            <BlockItem
              key={block.id}
              block={block}
              index={index}
              count={blocks.length}
              selected={block.id === selectedId}
              invalid={invalidIds.has(block.id)}
              onSelect={onSelect}
              onMove={onMove}
              onRemove={onRemove}
            />
          ))}
        </ol>
      </SortableList>
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

type BlockItemProps = {
  block: EditorBlock
  index: number
  count: number
  selected: boolean
  invalid: boolean
  onSelect: (id: string) => void
  onMove: (from: number, to: number) => void
  onRemove: (id: string) => void
}

function BlockItem({ block, index, count, selected, invalid, ...actions }: BlockItemProps) {
  const sortable = useSortableItem(block.id)
  const arrows = useMoveButtons(index, count, actions.onMove)

  const remove = () => {
    if (window.confirm(`Удалить блок «${summaryOf(block)}»?`)) actions.onRemove(block.id)
  }

  return (
    <li
      ref={sortable.ref}
      style={sortable.style}
      className={styles.item}
      data-selected={selected}
      data-dragging={sortable.dragging}
    >
      <DragHandle handle={sortable.handle} label={`Перетащить блок «${summaryOf(block)}»`} />
      <button type="button" className={styles.select} onClick={() => actions.onSelect(block.id)}>
        <span className={styles.type}>
          {catalogEntry(block.type).title}
          {invalid && <span className={styles.badge}>ошибка</span>}
        </span>
        <span className={styles.summary}>{summaryOf(block)}</span>
      </button>
      <div className={styles.actions}>
        <button type="button" aria-label="Поднять блок" {...arrows.up}>
          ↑
        </button>
        <button type="button" aria-label="Опустить блок" {...arrows.down}>
          ↓
        </button>
        <button type="button" aria-label="Удалить блок" onClick={remove}>
          ✕
        </button>
      </div>
    </li>
  )
}

/** Подпись блока в списке: его заголовок, если он есть, иначе id */
function summaryOf(block: EditorBlock) {
  const title = block.props.title
  return typeof title === 'string' && title !== '' ? title : `#${block.id}`
}
