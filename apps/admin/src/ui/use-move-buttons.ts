import { useEffect, useRef } from 'react'

/**
 * Стрелки ↑↓ пункта списка. Ключи пунктов постоянные, поэтому кнопка в фокусе уезжает вместе
 * с пунктом. На краю списка она становится disabled, и фокус клавиатуры потерялся бы —
 * тогда переводим его на соседнюю стрелку того же пункта
 */
export function useMoveButtons(
  index: number,
  count: number,
  onMove: (from: number, to: number) => void,
) {
  const up = useRef<HTMLButtonElement>(null)
  const down = useRef<HTMLButtonElement>(null)
  const focusNext = useRef<'up' | 'down' | null>(null)

  useEffect(() => {
    const target = focusNext.current
    focusNext.current = null
    if (target === 'up') up.current?.focus()
    if (target === 'down') down.current?.focus()
  })

  return {
    up: {
      ref: up,
      disabled: index === 0,
      onClick: () => {
        if (index - 1 === 0) focusNext.current = 'down'
        onMove(index, index - 1)
      },
    },
    down: {
      ref: down,
      disabled: index === count - 1,
      onClick: () => {
        if (index + 1 === count - 1) focusNext.current = 'up'
        onMove(index, index + 1)
      },
    },
  }
}
