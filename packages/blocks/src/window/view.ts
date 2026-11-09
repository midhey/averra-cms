import type { PageContent, PageWindow } from '@averra/schema'

/** Окно сайта, готовое к выводу: id блоков уже с префиксом окна */
export type SiteWindowView = {
  /** Адрес страницы-окна: по нему ссылка находит окно (data-site-window) */
  slug: string
  /** Название страницы-окна: имя окна для диктора, когда у окна нет своего заголовка */
  label: string
  settings: PageWindow
  content: PageContent
  /** Адрес приёма заявок формы окна по id блока в окне (с префиксом) */
  formAction?: ((blockId: string) => string) | undefined
}

/** Префикс id блоков окна: id страницы-окна и страницы под ним могут совпасть («hero», «form») */
export const windowIdPrefix = (slug: string) => `w-${slug}-`

/**
 * Окно из страницы-окна: блоки с префиксом id, форма шлёт заявку на адрес приёма страницы-окна
 * с исходным id блока — API принимает её как заявку с этой страницы
 */
export function siteWindowView(
  page: { slug: string; title: string; content: PageContent },
  formActionOf?: (slug: string) => (blockId: string) => string,
): SiteWindowView | null {
  const settings = page.content.window
  if (!settings) return null
  const prefix = windowIdPrefix(page.slug)
  const action = formActionOf?.(page.slug)
  return {
    slug: page.slug,
    label: page.title,
    settings,
    content: {
      ...page.content,
      blocks: page.content.blocks.map((block) => ({ ...block, id: `${prefix}${block.id}` })),
    },
    formAction: action && ((blockId) => action(blockId.slice(prefix.length))),
  }
}
