import { PageSeo, type SeoCheck, type SeoCheckLevel } from '@averra/schema'
import { countRu } from '../format/plural'

// SEO страницы в редакторе: что сохранять, где ошибка, как показать сниппет и проверки

/**
 * SEO страницы в том виде, в каком его хранить: пустые строки и снятый флажок — как будто их нет.
 * Так нетронутая страница сохраняется без поля seo и не числится изменённой
 */
export function normalizedSeo(seo: PageSeo): PageSeo | undefined {
  const text = (value: string | undefined) => (value?.trim() ? value : undefined)
  const title = text(seo.title)
  const description = text(seo.description)
  const canonical = text(seo.canonical)
  const result: PageSeo = {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(seo.image ? { image: seo.image } : {}),
    ...(canonical !== undefined ? { canonical } : {}),
    ...(seo.noindex === true ? { noindex: true } : {}),
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export type SeoField = keyof PageSeo

/** Подписи полей — для ошибки над редактором, когда панель закрыта */
export const seoFieldLabels: Record<SeoField, string> = {
  title: 'SEO-заголовок',
  description: 'Описание',
  image: 'Картинка для соцсетей',
  canonical: 'Канонический адрес',
  noindex: 'Скрыть от поисковиков',
}

/**
 * SEO страницы по той же схеме, что у API: данные для сохранения или ошибки по полям. Ошибка не
 * даёт сохранить черновик — как у полей блоков
 */
export function checkPageSeo(seo: PageSeo) {
  const normalized = normalizedSeo(seo)
  const result = PageSeo.safeParse(normalized ?? {})
  const errors: Partial<Record<SeoField, string>> = {}
  for (const issue of result.error?.issues ?? []) {
    const field = issue.path[0] as SeoField | undefined
    if (field && errors[field] === undefined) errors[field] = issue.message
  }
  return { seo: normalized && result.success ? result.data : undefined, errors }
}

/** Сколько символов показывают поисковики — примерно: они режут по ширине в пикселях */
export const SNIPPET_LIMITS = {
  yandex: { title: 70, description: 240 },
  google: { title: 60, description: 160 },
} as const
export type SearchEngine = keyof typeof SNIPPET_LIMITS

/** Текст, обрезанный, как в выдаче: по слову, если оно близко к пределу, и с многоточием */
export function clip(text: string, max: number) {
  const chars = [...text.trim()]
  if (chars.length <= max) return chars.join('')
  const cut = chars.slice(0, max - 1).join('')
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.7 ? cut.slice(0, space) : cut).trimEnd()}…`
}

const levelOrder: Record<SeoCheckLevel, number> = { problem: 0, warning: 1, good: 2 }

/** Проверки для экрана: сначала важное, потом что поправить, потом что хорошо */
export const sortedChecks = (checks: readonly SeoCheck[]) =>
  checks.toSorted((a, b) => levelOrder[a.level] - levelOrder[b.level])

export const seoLevelLabels: Record<SeoCheckLevel, string> = {
  problem: 'Важно',
  warning: 'Стоит поправить',
  good: 'Хорошо',
}

/** «3 совета» — подпись счётчика на кнопке «SEO» */
export const adviceText = (count: number) => countRu(count, ['совет', 'совета', 'советов'])
