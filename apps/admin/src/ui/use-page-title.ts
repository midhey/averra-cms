import { useEffect } from 'react'

/**
 * Заголовок вкладки по экрану: «Сайты — Админка», «Мой сайт — страницы — Админка».
 * По нему различаются вкладки и записи истории браузера, а диктор объявляет смену экрана
 */
export function usePageTitle(...parts: string[]) {
  const title = [...parts, 'Админка'].join(' — ')
  useEffect(() => {
    document.title = title
  }, [title])
}
