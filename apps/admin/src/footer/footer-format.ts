import type { FooterContacts, FooterLayout } from '@averra/schema'
import type { StatusTone } from '../ui/StatusPill'

/** Плашка состояния у кнопок подвала: до первой публикации внизу сайта прежняя полоса */
export function footerStatus({
  unsaved,
  unpublished,
  onSite,
}: {
  unsaved: boolean
  unpublished: boolean
  onSite: boolean
}): { tone: StatusTone; text: string } {
  if (unsaved) return { tone: 'warning', text: 'Не сохранено' }
  if (!onSite) return { tone: 'info', text: 'Подвал пока не опубликован' }
  if (unpublished) return { tone: 'info', text: 'Сохранено · не опубликовано' }
  return { tone: 'success', text: 'Опубликован' }
}

/**
 * Чего из «SEO → Организация» подвалу не хватает: реквизиты нужны любому виду, контакты и соцсети
 * — колонкам. null у контактов — главная не опубликована, и на сайте их пока нет
 */
export function organizationNote(contacts: FooterContacts | null, layout: FooterLayout) {
  if (contacts === null) {
    return 'Реквизиты и контакты из «SEO → Организация» появятся в подвале, когда главная страница будет опубликована.'
  }
  const missing = [
    contacts.name === '' && 'название',
    contacts.inn === '' && 'ИНН',
    layout !== 'simple' && contacts.phone === '' && 'телефон',
    layout !== 'simple' && contacts.address === '' && 'адрес',
    layout !== 'simple' && contacts.socials.length === 0 && 'соцсети',
  ].filter((item): item is string => typeof item === 'string')
  if (missing.length === 0) {
    return 'Реквизиты, контакты и соцсети берутся из «SEO → Организация»: правьте их там.'
  }
  return `Реквизиты, контакты и соцсети берутся из «SEO → Организация». Там не заполнены: ${missing.join(', ')} — в подвале их не будет.`
}

/** Что с политикой: от неё зависят ссылка в подвале и форма «Перезвоните мне» */
export function policyNote(policy: { slug: string; published: boolean }, layout: FooterLayout) {
  if (policy.published) return null
  const where = policy.slug === '' ? 'не выбрана' : 'не опубликована'
  return layout === 'big'
    ? `Политика конфиденциальности ${where}: без неё ссылки в подвале нет, а большой подвал не опубликовать — в нём форма с телефоном. Выберите и опубликуйте её в «SEO → Cookie и согласие».`
    : `Политика конфиденциальности ${where} — ссылки на неё в подвале не будет. Выберите и опубликуйте её в «SEO → Cookie и согласие».`
}

/** Страницы, где подвал скрыт (поле страницы «Скрыть подвал сайта») */
export function footerHiddenOnText(pages: readonly { title: string; hidden: boolean }[]) {
  const hidden = pages.filter((page) => page.hidden)
  if (hidden.length === 0) return undefined
  return `Подвал скрыт на страницах: ${hidden.map((page) => `«${page.title}»`).join(', ')}`
}
