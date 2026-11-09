import {
  blocksUseBehaviors,
  customBlockKeysOf,
  MAIN_PAGE_SLUG,
  NOT_FOUND_PAGE_SLUG,
  type PageContent,
  pageSlugOfHref,
  templateUsesBehaviors,
  templateUsesWindow,
  windowSlugsOfBlocks,
} from '@averra/schema'
import type { CustomBlockMap } from '../custom/render'

type WindowPage = { slug: string; title: string; content: PageContent }

type NeededInput<P extends WindowPage> = {
  /** Открытая страница */
  page: { slug: string; content: PageContent }
  /** Опубликованные страницы сайта: среди них — страницы-окна */
  pages: readonly P[]
  /** Ссылки шапки и подвала на этой странице (меню, кнопка, разделы) */
  chromeLinks: readonly { href: string; window: boolean }[]
  /** Опубликованные свои блоки: шаблон с data-av-window или data-av-… */
  customBlocks: CustomBlockMap
  /** Ключи своих блоков страницы (без своих шапки и подвала — их смотрим по готовому HTML) */
  ownKeys: readonly string[]
  /**
   * Готовый HTML своих шапки и подвала (settlePlace). Их шаблон выводит data-av-window только у
   * пунктов с флажком (заготовка: {% if item.window %}), поэтому смотрим результат, а не шаблон:
   * иначе каждая страница со своей шапкой из заготовки получала бы все окна сайта и скрипт
   */
  placeHtml?: readonly string[]
}

/**
 * Какие окна положить на страницу и нужен ли ей скрипт поведений. Окна — опубликованные страницы
 * с настройкой «Окно», на которые ведут кнопки блоков, шапки и подвала с «Открывать в окне».
 * Свой шаблон со ссылкой в окно (data-av-window) выводит адрес только при рендере — тогда на
 * странице все окна сайта. Окна, на которые ведут ссылки из окон, — тоже (окно из окна). Страница
 * сама себе не окно, главная и 404 — не окна. Скрипт нужен, если есть окно или хоть одно поведение; video —
 * нужен ли скрипт плеера (блок «Видео» на странице или в её окнах)
 */
export function windowsAndBehaviors<P extends WindowPage>(input: NeededInput<P>) {
  const candidates = input.pages.filter(
    (candidate) =>
      candidate.content.window !== undefined &&
      candidate.slug !== input.page.slug &&
      candidate.slug !== NOT_FOUND_PAGE_SLUG &&
      // Главная окном не бывает (API не сохранит), но и старые данные её окном не сделают
      candidate.slug !== MAIN_PAGE_SLUG,
  )
  const template = (key: string) => input.customBlocks[key]?.template ?? ''
  const usesAll = (keys: Iterable<string>) =>
    [...keys].some((key) => templateUsesWindow(template(key)))

  const wanted = new Set<string>()
  const want = (content: PageContent, keys: Iterable<string>) => {
    if (usesAll(keys)) for (const candidate of candidates) wanted.add(candidate.slug)
    for (const slug of windowSlugsOfBlocks(content.blocks)) wanted.add(slug)
  }
  want(input.page.content, input.ownKeys)
  const placeHtml = input.placeHtml ?? []
  if (placeHtml.some(templateUsesWindow))
    for (const candidate of candidates) wanted.add(candidate.slug)
  for (const link of input.chromeLinks) {
    const slug = link.window ? pageSlugOfHref(link.href) : undefined
    if (slug) wanted.add(slug)
  }
  // Окно из окна: ссылки внутри уже выбранных окон — до неподвижной точки (окон немного)
  const windows: P[] = []
  let grew = true
  while (grew) {
    grew = false
    for (const candidate of candidates) {
      if (!wanted.has(candidate.slug) || windows.includes(candidate)) continue
      windows.push(candidate)
      want(candidate.content, customBlockKeysOf(candidate.content))
      grew = true
    }
  }

  const windowKeys = windows.flatMap((window) => [...customBlockKeysOf(window.content)])
  const behaviors =
    windows.length > 0 ||
    blocksUseBehaviors(input.page.content.blocks) ||
    placeHtml.some(templateUsesBehaviors) ||
    [...input.ownKeys, ...windowKeys].some((key) => templateUsesBehaviors(template(key)))
  // Плеер «Видео» нужен и тогда, когда блок стоит только в окне: окно — та же страница в DOM
  const video = [input.page.content, ...windows.map((window) => window.content)].some((content) =>
    content.blocks.some((block) => block.type === 'video'),
  )
  return { windows, windowKeys: [...new Set(windowKeys)], behaviors, video }
}
