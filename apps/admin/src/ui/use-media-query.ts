import { useCallback, useSyncExternalStore } from 'react'

/**
 * Совпадает ли окно с медиазапросом сейчас; перерисовка — когда совпадение меняется. Для того,
 * что CSS не решит: разметки и ролей, которые есть только на узком экране (вкладки редактора).
 * Границу берём ту же, что у `ui.breakpoint()` в стилях. Без `matchMedia` (старый браузер,
 * часть тестов) — «не совпадает»
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia?.(query)
      list?.addEventListener('change', onChange)
      return () => list?.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false)
}

/**
 * Узкий экран — уже `ui.breakpoint(medium)` (64rem): на нём у оболочки меню, у редактора вкладки
 */
export const NARROW_SCREEN = '(width < 64rem)'

/**
 * Средний экран — уже 80rem (1280 px): полосе редактора с подписями у всех кнопок не хватает места,
 * и «SEO» с «Историей» становятся иконками
 */
export const COMPACT_SCREEN = '(width < 80rem)'
