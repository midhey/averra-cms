import { useEffect } from 'react'

/**
 * Заголовок вкладки по экрану: «Сайты — Averra CMS», «Мой сайт — страницы — Averra CMS».
 * По нему различаются вкладки и записи истории браузера, а диктор объявляет смену экрана
 */
export function usePageTitle(...parts: string[]) {
  const title = [...parts, 'Averra CMS'].join(' — ')
  useEffect(() => {
    document.title = title
  }, [title])
}
