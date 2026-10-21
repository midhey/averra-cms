import { useEffect, useState } from 'react'

/**
 * Значение, которое догоняет исходное, когда оно перестало меняться на delay мс. Для того, что
 * дорого пересчитывать на каждую букву: картинка карточки из заголовка просит её у API
 */
export function useDebouncedValue<T>(value: T, delay: number) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return settled
}
