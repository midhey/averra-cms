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
    layout !== 'simple' && contacts.email === '' && 'почта',
    layout !== 'simple' && contacts.address === '' && 'адрес',
    layout !== 'simple' && contacts.socials.length === 0 && 'соцсети',
  ].filter((item): item is string => typeof item === 'string')
  if (missing.length === 0) {
    return 'Реквизиты, контакты и соцсети берутся из «SEO → Организация»: правьте их там.'
  }
  // «этого» согласуется и с одним пунктом, и с несколькими: «их» с одной «почтой» звучало криво
  const empty = missing.length === 1 ? 'не заполнено' : 'не заполнены'
  return `Реквизиты, контакты и соцсети берутся из «SEO → Организация». Там ${empty}: ${missing.join(', ')} — этого в подвале не будет.`
}

/**
 * Подсказка к флажку «Разделы — пункты меню шапки». Предпросмотр строит разделы по черновику меню,
 * а сайт — по опубликованной шапке. Поэтому подсказка говорит, что будет на сайте: шапку не
 * публиковали — колонки нет; меню в черновике другое — правки попадут в подвал с публикацией шапки.
 * menuOnSite — пунктов в меню опубликованной шапки, null — шапки на сайте нет
 */
export function sectionsNote({
  menuOnSite,
  menuEdited,
}: {
  menuOnSite: number | null
  menuEdited: boolean
}) {
  if (menuOnSite === null) {
    return 'Шапка не опубликована — на сайте колонки «Разделы» пока не будет. Разделы — пункты её меню'
  }
  if (menuOnSite === 0) {
    return menuEdited
      ? 'В меню шапки на сайте нет пунктов — колонка «Разделы» появится, когда вы опубликуете шапку с меню'
      : 'В меню шапки пока нет пунктов — колонки «Разделы» не будет'
  }
  return menuEdited
    ? 'На сайте — пункты меню опубликованной шапки: правки меню попадут в подвал, когда вы опубликуете шапку'
    : 'Те же пункты, что в меню шапки: правьте их на вкладке «Меню»'
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
