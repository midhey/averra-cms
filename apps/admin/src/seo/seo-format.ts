import {
  applyTitleTemplate,
  normalizeRedirectPath,
  type Redirect,
  type SiteSettings,
  SiteSettingsPatch,
  type SiteSettingsPatchInput,
  SiteUrl,
} from '@averra/schema'
import type { FieldErrors } from '../forms/field-errors'
import { pagePath } from '../pages-format'

// Как раздел «SEO» показывает и собирает настройки: подписи, пример заголовка, сниппет поиска,
// соцсети строками и строки таблицы редиректов

/** Ошибка у поля name — своя или у его частей (organization.socials.1 → organization.socials) */
export function fieldError(errors: FieldErrors, name: string) {
  if (errors[name] !== undefined) return errors[name]
  const nested = Object.keys(errors).find((key) => key.startsWith(`${name}.`))
  return nested === undefined ? undefined : errors[nested]
}

/** Заголовок, на котором показываем шаблон: «Цены — Ремонт у Ивана» */
export const SAMPLE_PAGE_TITLE = 'Цены'

export const titleExample = (template: string) => applyTitleTemplate(template, SAMPLE_PAGE_TITLE)

const hostOf = (url: string | null) =>
  url !== null && URL.canParse(url) ? new URL(url).host : undefined

/** Домен набранного адреса, если адрес уже годится как адрес сайта. Набираемый по буквам — нет */
function typedHost(typed: string) {
  const parsed = SiteUrl.safeParse(typed)
  return parsed.success && parsed.data !== '' ? hostOf(parsed.data) : undefined
}

/**
 * Адрес в сниппете поиска: домен и путь через «›», как показывают поисковики. Набранный адрес —
 * сырой ввод, пока его печатают («h», «https:/»): тогда домен берётся у адреса установки, а
 * ошибку показывает поле
 */
export function snippetAddress(typed: string, installationUrl: string | null, path: string) {
  const host = typedHost(typed) ?? hostOf(installationUrl) ?? 'ваш-сайт.ru'
  const parts = path.split('/').filter(Boolean)
  return [host, ...parts].join(' › ')
}

/** Ссылки на соцсети: по одной в строке. Пустые строки не в счёт */
export const parseSocials = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

export const socialsText = (socials: readonly string[]) => socials.join('\n')

/** Строка таблицы редиректов с постоянным ключом: строки удаляют из середины */
export type RedirectRow = { key: string; from: string; to: string }

let rowCounter = 0
const nextKey = () => `redirect-${++rowCounter}`

export const redirectRows = (redirects: readonly Redirect[]): RedirectRow[] =>
  redirects.map((redirect) => ({ key: nextKey(), ...redirect }))

export const emptyRedirectRow = (): RedirectRow => ({ key: nextKey(), from: '', to: '' })

/** Таблица для API: строки целиком пустые не отправляем — это несохранённое «Добавить» */
export const rowsToRedirects = (rows: readonly RedirectRow[]) =>
  rows
    .filter((row) => row.from.trim() !== '' || row.to.trim() !== '')
    .map(({ from, to }) => ({ from, to }))

/**
 * Страница по адресу «откуда»: она главнее редиректа, и редирект не сработает. Страницу могли
 * создать уже после редиректа — таблица сохранилась раньше, и об этом говорит только экран.
 * Проверка — как у API при сохранении таблицы: по всем страницам, черновикам тоже
 */
export function shadowingPage<P extends { slug: string; title: string }>(
  from: string,
  pages: readonly P[],
) {
  const path = from.trim()
  if (!path.startsWith('/')) return undefined
  const normalized = normalizeRedirectPath(path)
  return pages.find((page) => normalizeRedirectPath(pagePath(page.slug)) === normalized)
}

/**
 * Индекс строки в том, что уйдёт в API: ошибки API приходят по нему (redirects.2.from), а на
 * экране могут быть пустые строки, которые не отправляются
 */
export function sentIndexes(rows: readonly RedirectRow[]) {
  let index = 0
  return rows.map((row) => (row.from.trim() !== '' || row.to.trim() !== '' ? index++ : undefined))
}

/**
 * Есть ли в карточке правки, которых нет на сервере. Сравнивается то, что уйдёт в API (после
 * схемы: адрес строчными, код из мета-тега), с сохранёнными настройками — поэтому «поправил и
 * вернул как было» правкой не считается. Не проходит схему — правка есть: её не сохранить молча
 */
export function hasUnsavedChanges(patch: SiteSettingsPatchInput, saved: SiteSettings) {
  const parsed = SiteSettingsPatch.safeParse(patch)
  if (!parsed.success) return true
  return Object.entries(parsed.data).some(
    ([key, value]) => JSON.stringify(value) !== JSON.stringify(saved[key as keyof SiteSettings]),
  )
}
