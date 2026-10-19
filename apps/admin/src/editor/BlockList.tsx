import { PAGE_MAX_BLOCKS } from '@averra/schema'
import { useId, useMemo } from 'react'
import { Button, IconButton } from '../ui/Button'
import { DragHandle, SortableList, useSortableItem } from '../ui/SortableList'
import { StatusPill } from '../ui/StatusPill'
import { useMoveButtons } from '../ui/use-move-buttons'
import styles from './BlockList.module.scss'
import { blockHint, blockName } from './block-hint'
import { catalogEntry } from './catalog'
import type { EditorBlock } from './draft'

type BlockListProps = {
  blocks: readonly EditorBlock[]
  selectedId: string | null
  invalidIds: ReadonlySet<string>
  onSelect: (id: string) => void
  /** Перестановка и стрелками, и перетаскиванием: блок с места from встаёт на место to */
  onMove: (from: number, to: number) => void
  onRemove: (id: string) => void
  /** «Добавить блок»: окно с каталогом открывает редактор */
  onAdd: () => void
}

/**
 * Блоки страницы по порядку: ручка, тип и подсказка содержимого. Выбранный блок — в рамке,
 * со стрелками и удалением, его поля справа
 */
export function BlockList(props: BlockListProps) {
  const { blocks, selectedId, invalidIds, onSelect, onMove, onRemove, onAdd } = props
  const headingId = useId()
  const limitId = useId()
  const full = blocks.length >= PAGE_MAX_BLOCKS
  const entries = useMemo(
    () => blocks.map((block) => ({ id: block.id, label: blockName(block) })),
    [blocks],
  )

  return (
    <nav className={styles.panel} aria-label="Блоки страницы">
      <div className={styles.header}>
        <h2 id={headingId} className={styles.heading}>
          Блоки
        </h2>
        <span className={styles.count}>
          {blocks.length} из {PAGE_MAX_BLOCKS}
        </span>
      </div>
      {blocks.length === 0 && (
        <p className={styles.empty}>На странице пока нет блоков. Начните с первого экрана.</p>
      )}
      <SortableList entries={entries} noun="блок" onMove={onMove}>
        <ol className={styles.list} aria-labelledby={headingId}>
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
      <Button
        icon="plus"
        className={styles.add}
        disabled={full}
        aria-describedby={full ? limitId : undefined}
        onClick={onAdd}
      >
        Добавить блок
      </Button>
      {full && (
        <p id={limitId} className={styles.empty}>
          На странице уже {PAGE_MAX_BLOCKS} блоков — больше не поместится.
        </p>
      )}
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
  const name = blockName(block)

  const remove = () => {
    if (window.confirm(`Удалить блок «${name}»?`)) actions.onRemove(block.id)
  }

  return (
    <li
      ref={sortable.ref}
      style={sortable.style}
      className={styles.item}
      data-selected={selected}
      data-dragging={sortable.dragging}
    >
      <DragHandle handle={sortable.handle} label={`Перетащить блок «${name}»`} />
      <button
        type="button"
        className={styles.select}
        aria-current={selected ? 'true' : undefined}
        onClick={() => actions.onSelect(block.id)}
      >
        <span className={styles.type}>
          {catalogEntry(block.type).title}
          {invalid && <StatusPill tone="danger">Ошибка</StatusPill>}
        </span>
        <span className={styles.hint}>{blockHint(block)}</span>
      </button>
      {/* Стрелки и удаление — у выбранного блока: список остаётся чистым, как в концепте,
          а лишних остановок Tab у каждого блока нет. Переставить любой блок можно и ручкой */}
      {selected && (
        <span className={styles.actions}>
          <IconButton label="Поднять блок" icon="arrow-up" size="small" {...arrows.up} />
          <IconButton label="Опустить блок" icon="arrow-down" size="small" {...arrows.down} />
          <IconButton label="Удалить блок" icon="trash" size="small" onClick={remove} />
        </span>
      )}
    </li>
  )
}
