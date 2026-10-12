import { useId, useRef } from 'react'
import { moveItem } from '../ui/sortable'

/**
 * Ключи под новую длину списка: прежние остаются на своих местах, недостающие добавляются
 * в конец, лишние обрезаются с конца. Та же длина — тот же массив
 */
export function syncKeys(
  keys: readonly string[],
  length: number,
  makeKey: () => string,
): readonly string[] {
  if (keys.length === length) return keys
  if (keys.length > length) return keys.slice(0, length)
  return [...keys, ...Array.from({ length: length - keys.length }, makeKey)]
}

/**
 * Постоянные ключи пунктов списка, у которых нет своих id. Перетаскиванию нужен постоянный
 * идентификатор пункта, а ключ по индексу после перестановки указывал бы на соседа.
 * Ключи живут рядом со значением, а не в нём: схема пунктов строгая, лишнее поле — ошибка.
 * Свои операции (перестановка, удаление) двигают и ключи; список, изменённый снаружи,
 * достраивается по длине
 */
export function useItemKeys(length: number) {
  const prefix = useId()
  const counter = useRef(0)
  const keys = useRef<readonly string[]>([])
  // Синхронизация прямо в отрисовке: ключи нужны в этой же отрисовке, а не после эффекта.
  // Повторная отрисовка с той же длиной ничего не меняет
  keys.current = syncKeys(keys.current, length, () => `${prefix}${counter.current++}`)
  return {
    keys: keys.current,
    move: (from: number, to: number) => {
      keys.current = moveItem(keys.current, from, to)
    },
    remove: (index: number) => {
      keys.current = keys.current.toSpliced(index, 1)
    },
  }
}
