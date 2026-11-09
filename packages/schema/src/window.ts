import { MAIN_PAGE_SLUG } from './page'

// Окна и поведения сайта: какие окна нужны странице и нужен ли ей скрипт поведений. Чистые
// функции: их зовёт сборка (рендерер) и предпросмотр. Решение — «Решения → Окна и поведения»

/** Атрибут ссылки, которая открывает окно: его ставят встроенные кнопки и пишут свои шаблоны */
export const WINDOW_LINK_ATTRIBUTE = 'data-av-window'

/** Начало атрибутов поведений Averra: data-av-reveal, data-av-details, data-av-hint, data-av-draw */
export const BEHAVIOR_ATTRIBUTE_PREFIX = 'data-av-'

/**
 * Страница сайта по адресу ссылки: «/», «/zapis», «/zapis/», «/zapis/?utm=…#форма». Внешние и
 * вложенные адреса, якоря на этой же странице и всё, что не похоже на адрес страницы, — undefined:
 * окном открывается только своя страница
 */
export function pageSlugOfHref(href: string): string | undefined {
  const path = href.trim().split(/[?#]/, 1)[0] ?? ''
  if (path === '/') return MAIN_PAGE_SLUG
  const match = /^\/([a-z0-9-]{1,64})\/?$/.exec(path)
  return match?.[1]
}

/** Ссылка-кнопка, которая просит открыть окно (поле window у Button) */
type WindowButton = { href: string; window: true }

const isWindowButton = (value: unknown): value is WindowButton =>
  typeof value === 'object' &&
  value !== null &&
  (value as { window?: unknown }).window === true &&
  typeof (value as { href?: unknown }).href === 'string'

/** Все кнопки с «Открывать в окне» в полях блоков — где угодно в глубине (тарифы, свои поля) */
function windowHrefsIn(value: unknown, found: string[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) windowHrefsIn(item, found)
  } else if (value !== null && typeof value === 'object') {
    if (isWindowButton(value)) found.push(value.href)
    for (const item of Object.values(value)) windowHrefsIn(item, found)
  }
  return found
}

type BlockLike = { readonly type: string; readonly props?: unknown }

/**
 * Адреса страниц, которые кнопки блоков просят открыть окном. Свой шаблон с атрибутом
 * data-av-window сюда не попадает: какой адрес он выведет, известно только после рендера —
 * такой странице сборка кладёт все окна сайта (templatesUseWindow)
 */
export function windowSlugsOfBlocks(blocks: readonly BlockLike[]) {
  const slugs = new Set<string>()
  for (const block of blocks) {
    for (const href of windowHrefsIn(block.props)) {
      const slug = pageSlugOfHref(href)
      if (slug) slugs.add(slug)
    }
  }
  return slugs
}

/** В шаблоне своего блока или места есть ссылка в окно */
export const templateUsesWindow = (template: string) => template.includes(WINDOW_LINK_ATTRIBUTE)

/** В шаблоне своего блока или места есть поведение Averra (data-av-…) */
export const templateUsesBehaviors = (template: string) =>
  template.includes(BEHAVIOR_ATTRIBUTE_PREFIX)

/**
 * Встроенные блоки страницы с поведением: появление при прокрутке (reveal) или плавный FAQ
 * (smooth). По ним сборка решает, нужен ли странице скрипт поведений. Кнопки в окно сюда не
 * входят: скрипт им нужен, только если окно на странице есть
 */
export function blocksUseBehaviors(blocks: readonly BlockLike[]) {
  return blocks.some((block) => {
    const props = block.props as { reveal?: unknown; smooth?: unknown } | undefined
    return (props?.reveal !== undefined && props.reveal !== 'none') || props?.smooth === true
  })
}
