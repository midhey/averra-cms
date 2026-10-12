import type { Announcements, UniqueIdentifier } from '@dnd-kit/core'

/** Пункт перестановки: id и имя, по которому его узнает человек (заголовок, «№ 2») */
export type SortableEntry = { id: string; label: string }

/**
 * Что переставляют. Только существительные мужского рода: окончания в объявлениях
 * («поднят», «остался») от этого зависят и записаны прямо в тексты
 */
export type SortableNoun = 'блок' | 'пункт'

/** Список с элементом from на месте to. За краем или на то же место — тот же список */
export function moveItem<T>(list: readonly T[], from: number, to: number): readonly T[] {
  const item = list[from]
  if (item === undefined || to < 0 || to >= list.length || from === to) return list
  return list.toSpliced(from, 1).toSpliced(to, 0, item)
}

/** Подсказка, которую диктор читает на ручке перетаскивания */
export function dragInstructions(noun: SortableNoun) {
  return `Чтобы переставить ${noun}, нажмите пробел или Enter, двигайте его стрелками вверх и вниз, затем снова нажмите пробел или Enter. Escape отменяет перестановку.`
}

/**
 * Объявления для диктора по-русски, с именами, а не id. Позиция «N из M» считается по списку
 * на момент начала перетаскивания: пока его тащат, сам список не меняется.
 *
 * Сразу после подъёма dnd-kit сообщает «над собой» (onDragOver с тем же id) и перебил бы
 * «поднят» до того, как диктор его прочтёт. Поэтому позицию объявляем, только когда она
 * сменилась: undefined dnd-kit не объявляет
 */
export function dragAnnouncements(
  entries: readonly SortableEntry[],
  noun: SortableNoun,
): Announcements {
  const Noun = noun[0]?.toUpperCase() + noun.slice(1)
  const indexOf = (id: UniqueIdentifier) => entries.findIndex((entry) => entry.id === id)
  const name = (id: UniqueIdentifier) => `${Noun} «${entries[indexOf(id)]?.label ?? id}»`
  const position = (id: UniqueIdentifier) => `${indexOf(id) + 1} из ${entries.length}`
  let lastOver: UniqueIdentifier | null = null

  return {
    onDragStart: ({ active }) => {
      lastOver = active.id
      return `${name(active.id)} поднят. Позиция ${position(active.id)}.`
    },
    onDragOver: ({ active, over }) => {
      const overId = over?.id ?? null
      if (overId === lastOver) return undefined
      lastOver = overId
      return over
        ? `${name(active.id)} на позиции ${position(over.id)}.`
        : `${name(active.id)} вне списка.`
    },
    onDragEnd: ({ active, over }) =>
      over
        ? `${name(active.id)} поставлен на позицию ${position(over.id)}.`
        : `${name(active.id)} остался на позиции ${position(active.id)}.`,
    onDragCancel: ({ active }) =>
      `Перетаскивание отменено. ${name(active.id)} остался на позиции ${position(active.id)}.`,
  }
}
