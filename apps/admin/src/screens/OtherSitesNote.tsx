import { pluralRu } from '../format/plural'
import { InlineAlert } from '../ui/InlineAlert'

/**
 * Заметка владельцу на обзоре: в старой базе разработки, кроме сайта установки, есть и другие
 * сайты. otherSites — сколько их (GET /api/site); 0 — нет, null — не владелец: заметки нет
 */
export function OtherSitesNote({ otherSites }: { otherSites: number | null }) {
  if (!otherSites) return null
  const one = pluralRu(otherSites, ['one', 'many', 'many']) === 'one'
  return (
    <InlineAlert tone="info" title="В базе есть и другие сайты">
      В базе ещё {otherSites} {pluralRu(otherSites, ['сайт', 'сайта', 'сайтов'])}:{' '}
      {one ? 'он сохранён, но в админке не виден' : 'они сохранены, но в админке не видны'}. Одна
      установка — один сайт, и админка работает с созданным первым.
    </InlineAlert>
  )
}
