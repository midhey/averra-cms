import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { type CSSProperties, type ReactNode, useMemo } from 'react'
import {
  dragAnnouncements,
  dragInstructions,
  type SortableEntry,
  type SortableNoun,
} from './sortable'
import styles from './ui.module.css'

// Списки в админке вертикальные: сдвиг вбок только сбивал бы, куда встанет пункт
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

type SortableListProps = {
  /** Пункты в нынешнем порядке: id для dnd-kit и имена для объявлений диктора */
  entries: readonly SortableEntry[]
  noun: SortableNoun
  onMove: (from: number, to: number) => void
  children: ReactNode
}

/**
 * Вертикальный список, который переставляют перетаскиванием: мышью или пальцем за ручку
 * и с клавиатуры (пробел — поднять, стрелки — двигать, пробел — поставить, Escape — отменить).
 * Порядок меняется один раз, когда пункт поставлен
 */
export function SortableList({ entries, noun, onMove, children }: SortableListProps) {
  const sensors = useSensors(
    // Порог, чтобы простой щелчок по ручке не начинал перетаскивание
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = useMemo(() => entries.map((entry) => entry.id), [entries])
  const accessibility = useMemo(
    () => ({
      announcements: dragAnnouncements(entries, noun),
      screenReaderInstructions: { draggable: dragInstructions(noun) },
    }),
    [entries, noun],
  )

  const drop = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from !== -1 && to !== -1 && from !== to) onMove(from, to)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      accessibility={accessibility}
      onDragEnd={drop}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

/** Свойства пункта списка: на сам пункт — ref и style, на ручку — handle */
export function useSortableItem(id: string, noun: SortableNoun) {
  const sortable = useSortable({ id, attributes: { roleDescription: `перетаскиваемый ${noun}` } })
  const style: CSSProperties = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  }
  return {
    ref: sortable.setNodeRef,
    style,
    dragging: sortable.isDragging,
    handle: {
      ref: sortable.setActivatorNodeRef,
      ...sortable.attributes,
      ...sortable.listeners,
    },
  }
}

type DragHandleProps = {
  handle: ReturnType<typeof useSortableItem>['handle']
  label: string
}

/** Ручка перетаскивания. Подсказку о клавишах dnd-kit связывает с ней через aria-describedby */
export function DragHandle({ handle, label }: DragHandleProps) {
  return (
    <button type="button" className={styles.dragHandle} aria-label={label} {...handle}>
      ⠿
    </button>
  )
}
