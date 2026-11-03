import type { CustomBlockMap } from '@averra/blocks'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { customBlocksQuery } from '../queries'
import { publishedDefinitions } from './custom-block-format'

/**
 * Опубликованные свои блоки сайта по ключу — для предпросмотра, который рисует страницу вне
 * редактора («Тема», «Шапка и подвал»). Без них на месте каждого своего блока было бы «блока нет
 * на сайте». Не suspense: сбой загрузки не должен ронять экран, предпросмотр просто покажет
 * причину на месте блока
 */
export function useCustomBlockMap(siteId: string): CustomBlockMap {
  const custom = useQuery(customBlocksQuery(siteId))
  return useMemo(
    () =>
      Object.fromEntries(
        publishedDefinitions(custom.data?.blocks ?? []).map((item) => [item.key, item]),
      ),
    [custom.data],
  )
}
