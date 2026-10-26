import {
  type Header,
  type HeaderTargetPage,
  MAIN_PAGE_SLUG,
  type MenuItem,
  pageLinkTitle,
  type SiteLink,
  siteLinkHref,
} from '@averra/schema'
import type { StatusTone } from '../ui/StatusPill'

/** Значение выбора «куда ведёт»: адрес страницы или адрес#блок */
export const targetValue = (link: SiteLink) =>
  link.block ? `${link.page}#${link.block}` : link.page

/** Обратно из значения выбора: страница и блок */
export function linkOf(value: string): SiteLink {
  const [page = '', block] = value.split('#')
  return block ? { page, block } : { page }
}

export type TargetGroup = {
  label: string
  options: { value: string; label: string }[]
}

/**
 * Варианты «куда ведёт», по страницам: сама страница и её блоки (по заголовку блока и якорю).
 * Неопубликованная страница — с пометкой: на сайт её пункт попадёт только после публикации.
 * Цель, которой уже нет (удалили страницу или блок), остаётся в списке отдельной группой — иначе
 * выбор молча показал бы другую
 */
export function targetGroups(pages: readonly HeaderTargetPage[], current?: SiteLink) {
  const groups: TargetGroup[] = pages.map((page) => ({
    label: page.published ? pageLinkTitle(page) : `${pageLinkTitle(page)} — не опубликована`,
    options: [
      { value: page.slug, label: `${page.title} — вся страница` },
      ...page.blocks.map((block) => ({
        value: `${page.slug}#${block.id}`,
        label: `${block.label ?? 'Блок'} · #${block.id}`,
      })),
    ],
  }))
  if (current) {
    const value = targetValue(current)
    const known = groups.some((group) => group.options.some((option) => option.value === value))
    if (!known) {
      groups.push({
        label: 'Больше нет на сайте',
        options: [{ value, label: siteLinkHref(current) }],
      })
    }
  }
  return groups
}

/** Новый пункт меню: на главную, подпись пустая — её человек впишет сам */
export const newMenuItem = (): MenuItem => ({ label: '', page: MAIN_PAGE_SLUG })

/** Кнопка шапки, когда её включают: ведёт на главную, текст — частый «Оставить заявку» */
export const newHeaderButton = (pages: readonly HeaderTargetPage[]): Header['button'] => {
  const main = pages.find((page) => page.slug === MAIN_PAGE_SLUG)
  const form = main?.blocks.find((block) => block.type === 'form' || block.type === 'cta')
  return {
    label: 'Оставить заявку',
    page: MAIN_PAGE_SLUG,
    ...(form ? { block: form.id } : {}),
  }
}

/** Плашка состояния у кнопок: как у темы, но шапки на сайте может ещё не быть */
export function headerStatus({
  unsaved,
  unpublished,
  onSite,
}: {
  unsaved: boolean
  unpublished: boolean
  onSite: boolean
}): { tone: StatusTone; text: string } {
  if (unsaved) return { tone: 'warning', text: 'Не сохранено' }
  if (!onSite) return { tone: 'info', text: 'Шапки пока нет на сайте' }
  if (unpublished) return { tone: 'info', text: 'Сохранено · не опубликовано' }
  return { tone: 'success', text: 'Опубликована' }
}

/**
 * Где прозрачная шапка сработает: на опубликованных страницах, которые начинаются с «Первого
 * экрана» на фото. На остальных она обычная — это и говорит подсказка, с тем, как это изменить
 */
export function overlayHint(pages: readonly HeaderTargetPage[]) {
  const fits = pages.filter((page) => page.published && page.overlay)
  if (fits.length === 0) {
    return 'Ложится на фото «Первого экрана» в варианте «На фото». Ни одна опубликованная страница с него не начинается — пока шапка везде обычная'
  }
  const names = fits.map((page) => `«${page.title}»`).join(', ')
  return `Ложится на фото «Первого экрана» в варианте «На фото»: ${names}. На остальных страницах шапка обычная`
}

/** Страницы, где шапка скрыта (поле страницы «Скрыть шапку сайта») */
export function hiddenOnText(pages: readonly HeaderTargetPage[]) {
  const hidden = pages.filter((page) => page.published && page.hideHeader)
  if (hidden.length === 0) return undefined
  return `Шапка скрыта на страницах: ${hidden.map((page) => `«${page.title}»`).join(', ')}`
}

/** Подпись пункта для диктора и объявлений перетаскивания */
export const menuItemName = (item: MenuItem, index: number) =>
  item.label.trim() === '' ? `Пункт ${index + 1}` : item.label.trim()
