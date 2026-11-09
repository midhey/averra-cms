import {
  type Header,
  type HeaderLink,
  type HeaderTargetPage,
  MAIN_PAGE_SLUG,
  type MenuItem,
  pageLinkTitle,
  siteLinkHref,
} from '@averra/schema'
import type { StatusTone } from '../ui/StatusPill'

/**
 * Значение выбора «куда ведёт» для внешней ссылки. «~» не бывает ни в адресе страницы, ни в id
 * блока — с ними значение не совпадёт
 */
export const EXTERNAL_TARGET = '~url'

/** Значение выбора «куда ведёт»: адрес страницы, адрес#блок или внешняя ссылка */
export const targetValue = (link: HeaderLink) => {
  if (link.url !== undefined) return EXTERNAL_TARGET
  const page = link.page ?? ''
  return link.block ? `${page}#${link.block}` : page
}

/**
 * Обратно из значения выбора: страница и блок — или внешняя ссылка (адрес вписывают отдельным
 * полем, пока он пустой). «Новая вкладка» у цели своя: сменили цель — по умолчанию для неё
 */
export function linkOf(value: string, current?: HeaderLink): HeaderLink {
  if (value === EXTERNAL_TARGET) return { url: current?.url ?? '' }
  const [page = '', block] = value.split('#')
  return block ? { page, block } : { page }
}

/** Пункт или кнопка с другой целью: подписи остаются, цель, «новая вкладка» и «окно» — новые */
export const withTarget = <T extends { label: string; mobileLabel: string }>(
  item: T,
  link: HeaderLink,
): T & HeaderLink => {
  const {
    page: _page,
    block: _block,
    url: _url,
    newTab: _newTab,
    window: _window,
    ...rest
  } = item as T & HeaderLink
  return { ...(rest as T), ...link }
}

export type TargetGroup = {
  label: string
  options: { value: string; label: string }[]
}

/**
 * Варианты «куда ведёт», по страницам: сама страница и её блоки (по заголовку блока и якорю).
 * Блоки — только текущей версии, черновика: меню собирается из него и им же публикуется, а блоки
 * прежней опубликованной версии (демо-главная до импорта) только путали бы выбор. Неопубликованная
 * страница — с пометкой: на сайт её пункт попадёт только после публикации. Цель, которой нет в
 * черновике (удалили страницу или блок), остаётся в списке отдельной группой — иначе выбор молча
 * показал бы другую. Последняя группа — внешняя ссылка: Telegram, телефон, почта
 */
export function targetGroups(pages: readonly HeaderTargetPage[], current?: HeaderLink) {
  const groups: TargetGroup[] = pages.map((page) => ({
    label: page.published ? pageLinkTitle(page) : `${pageLinkTitle(page)} — не опубликована`,
    options: [
      { value: page.slug, label: `${page.title} — вся страница` },
      ...page.blocks
        .filter((block) => block.draft)
        .map((block) => ({
          value: `${page.slug}#${block.id}`,
          label: `${block.label ?? 'Блок'} · #${block.id}`,
        })),
    ],
  }))
  if (current && current.url === undefined) {
    const value = targetValue(current)
    const known = groups.some((group) => group.options.some((option) => option.value === value))
    if (!known) {
      // Блок убрали из черновика, но на сайте он ещё есть: пункт работает, пока не опубликуют
      const onlyOnSite = pages
        .find((page) => page.slug === current.page)
        ?.blocks.find((block) => block.id === current.block && block.published)
      groups.push({
        label: onlyOnSite ? 'Убран из черновика, пока есть на сайте' : 'Больше нет на сайте',
        options: [
          { value, label: siteLinkHref({ page: current.page ?? '', block: current.block }) },
        ],
      })
    }
  }
  groups.push({
    label: 'Другой сайт',
    options: [{ value: EXTERNAL_TARGET, label: 'Внешняя ссылка: Telegram, телефон, почта…' }],
  })
  return groups
}

/** Новый пункт меню: на главную, подпись пустая — её человек впишет сам */
export const newMenuItem = (): MenuItem => ({ label: '', mobileLabel: '', page: MAIN_PAGE_SLUG })

/** Кнопка шапки, когда её включают: ведёт на главную, текст — частый «Оставить заявку» */
export const newHeaderButton = (pages: readonly HeaderTargetPage[]): Header['button'] => {
  const main = pages.find((page) => page.slug === MAIN_PAGE_SLUG)
  const form = main?.blocks.find((block) => block.type === 'form' || block.type === 'cta')
  return {
    label: 'Оставить заявку',
    mobileLabel: '',
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
