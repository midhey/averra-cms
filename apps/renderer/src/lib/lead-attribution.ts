import { type CustomBlockMap, cookieNoticeView, settlePlace, siteFooterView } from '@averra/blocks'
import {
  type Footer,
  footerContacts,
  type Header,
  type MediaMap,
  type PageContent,
  type StoredSiteSettings,
  visibleBlocks,
} from '@averra/schema'

type Page = { slug: string; content: PageContent }

/** Решение для всего снимка: метки нужны и на странице входа, где самой формы может не быть. */
export function leadAttributionNeeded(input: {
  site: { name: string; header: Header | null; footer: Footer | null; settings: StoredSiteSettings }
  pages: readonly Page[]
  media: MediaMap
  customBlocks: CustomBlockMap
}) {
  const { site, pages, media, customBlocks } = input
  // Страницы-окна входят в тот же список опубликованных страниц; скрытые блоки не выводятся.
  if (
    pages.some((page) => visibleBlocks(page.content.blocks).some((block) => block.type === 'form'))
  )
    return true
  if (site.footer?.layout !== 'big') return false

  const legal = cookieNoticeView(
    site.settings,
    pages.map((page) => page.slug),
  ).footer
  if (!legal.policyHref) return false
  const links = pages.map((candidate) => ({
    slug: candidate.slug,
    blockIds: visibleBlocks(candidate.content.blocks).map((block) => block.id),
  }))
  return pages.some((page) => {
    const view = siteFooterView({
      footer: site.footer,
      siteName: site.name,
      page,
      header: site.header,
      pages: links,
      contacts: footerContacts(site.settings.organization),
      legal,
      year: new Date().getFullYear(),
    })
    if (!view?.callback) return false
    // Свой подвал заменяет стандартную форму; при ошибке шаблона выводится стандартный вид.
    const { view: rendered } = settlePlace(
      view,
      'footer',
      customBlocks,
      media,
      visibleBlocks(page.content.blocks).map((block) => block.id),
    )
    return rendered.custom === null
  })
}
