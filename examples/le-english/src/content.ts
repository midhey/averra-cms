// Контент le-english (content.default.json или data/content.json живого сайта) → блоки страницы
// Averra. Поля своих блоков повторяют src/schema.js исходного сайта, поэтому сопоставление почти
// один к одному; отличия — имена в нижнем регистре (photoCaption → photo_caption), повторители
// из строк (badges, points, backItems) становятся списками { text }, а фото — { mediaId, alt }.

type Json = Record<string, unknown>

const record = (value: unknown): Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** Фото исходного сайта: путь от public/ (assets/images/… или uploads/…) и подпись */
export type Photo = { src: string; alt: string }

const photoOf = (value: unknown): Photo | null => {
  const photo = record(value)
  const src = text(photo.src)
  return src === '' ? null : { src, alt: text(photo.alt) }
}

/** Все фото контента — их надо загрузить в медиатеку до сборки страницы */
export function photosOf(content: Json): Photo[] {
  const found: (Photo | null)[] = [
    photoOf(record(content.hero).photo),
    photoOf(record(content.about).photo),
    ...list(record(content.goals).cards).map((card) => photoOf(record(card).photo)),
    ...list(record(content.reviews).items).map((item) => {
      const photo = photoOf(record(item).photo)
      // alt у кружка с лицом ученика пустой, а поле «Картинка» его требует: имя — как подпись
      return photo && { ...photo, alt: text(record(item).name) || 'Фото ученика' }
    }),
  ]
  const unique = new Map<string, Photo>()
  for (const photo of found) if (photo && !unique.has(photo.src)) unique.set(photo.src, photo)
  return [...unique.values()]
}

/** Куда ведут кнопки «Записаться»: страница с формой заявки Averra */
// Со слэшем в конце: так страницу отдаёт сервер сайта, а без него был бы лишний редирект 308
export const SIGNUP_HREF = '/zapis/'

/** Секции главной по порядку страницы и их id: на них ссылается меню шапки */
export const SECTIONS = [
  { id: 'top', block: 'le-hero', menu: null },
  { id: 'goals', block: 'le-goals', menu: 'Цели', mobileMenu: 'Цели занятий' },
  { id: 'about', block: 'le-about', menu: 'Обо мне' },
  { id: 'steps', block: 'le-steps', menu: 'Занятия', mobileMenu: 'Как проходят занятия' },
  { id: 'reviews', block: 'le-reviews', menu: 'Отзывы' },
  { id: 'prices', block: 'le-prices', menu: 'Цены' },
  { id: 'faq', block: 'le-faq', menu: 'Вопросы' },
  { id: 'signup', block: 'le-signup', menu: null },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

/** Секции с пустым списком на исходном сайте не показываются вместе с пунктом меню */
export function hiddenSections(content: Json): Set<SectionId> {
  const hidden = new Set<SectionId>()
  if (list(record(content.steps).items).length === 0) hidden.add('steps')
  if (list(record(content.reviews).items).length === 0) hidden.add('reviews')
  if (list(record(content.prices).items).length === 0) hidden.add('prices')
  if (list(record(content.faq).items).length === 0) hidden.add('faq')
  return hidden
}

export type MediaOf = (photo: unknown) => { mediaId: string; alt: string } | undefined

/** Только заполненное: пустая строка и null в данных блока не нужны, поле необязательное */
const compact = (props: Json): Json =>
  Object.fromEntries(
    Object.entries(props).filter(
      ([, value]) => value !== '' && value !== null && value !== undefined,
    ),
  )

const items = (value: unknown, map: (item: Json, index: number) => Json) =>
  list(value).map((item, index) => compact(map(record(item), index)))

const texts = (value: unknown) => list(value).map((one) => ({ text: text(one) }))

/**
 * Конечная стрелка «↗» в исходном тексте — украшение: шаблон блока рисует её сам в span с
 * aria-hidden, и экранная читалка не произносит «стрелка вверх вправо». Из текста поля её убираем
 */
const withoutArrow = (value: string) => value.replace(/\s*↗\s*$/u, '')

const link = (label: unknown, href: string) => {
  const caption = withoutArrow(text(label).trim())
  return caption === '' ? undefined : { label: caption, href }
}

/**
 * Кнопка записи: на страницу /zapis/ и с «Открывать в окне» — с JS форма открывается поверх
 * страницы, как у оригинала (data-lead), без JS и Ctrl-кликом — переход на страницу записи
 */
const signupLink = (label: unknown) => {
  const button = link(label, SIGNUP_HREF)
  return button && { ...button, window: true }
}

/** Свойства блоков главной по содержимому исходного сайта */
export function blockProps(content: Json, mediaOf: MediaOf): Record<SectionId, Json> {
  const hero = record(content.hero)
  const goals = record(content.goals)
  const about = record(content.about)
  const steps = record(content.steps)
  const reviews = record(content.reviews)
  const prices = record(content.prices)
  const faq = record(content.faq)
  const signup = record(content.signup)
  const telegram = text(record(content.contacts).telegram)

  return {
    top: compact({
      eyebrow: text(hero.eyebrow),
      title: text(hero.title),
      lead: text(hero.lead),
      button: signupLink(hero.button),
      note: withoutArrow(text(hero.note)),
      badges: texts(hero.badges),
      photo: mediaOf(hero.photo),
      photo_caption: text(hero.photoCaption),
      sticker_top: text(hero.stickerTop),
      sticker_bottom: text(hero.stickerBottom),
    }),
    goals: compact({
      title: text(goals.title),
      cards: items(goals.cards, (card) => ({
        title: text(card.title),
        text: text(card.text),
        photo: mediaOf(card.photo),
        back_title: text(card.backTitle),
        back_items: texts(card.backItems),
      })),
    }),
    about: compact({
      title: text(about.title),
      text: text(about.text),
      points: texts(about.points),
      photo: mediaOf(about.photo),
      sticker: text(about.sticker),
    }),
    steps: compact({
      title: text(steps.title),
      aside: text(steps.aside),
      items: items(steps.items, (item) => ({ title: text(item.title), text: text(item.text) })),
    }),
    reviews: compact({
      title: text(reviews.title),
      lead: text(reviews.lead),
      note: text(reviews.note),
      cta: signupLink(reviews.cta),
      sticker: text(reviews.sticker),
      items: items(reviews.items, (item) => ({
        name: text(item.name),
        topic: text(item.topic),
        text: text(item.text),
        photo: mediaOf(item.photo),
        caption: text(item.caption),
      })),
    }),
    prices: compact({
      title: text(prices.title),
      aside: text(prices.aside),
      note: text(prices.note),
      items: items(prices.items, (item) => ({
        price: text(item.price),
        title: text(item.title),
        note: text(item.note),
        badge: text(item.badge),
      })),
    }),
    faq: compact({
      title: text(faq.title),
      aside: link(faq.aside, telegram),
      items: items(faq.items, (item) => ({
        question: text(item.question),
        answer: text(item.answer),
      })),
    }),
    signup: compact({
      eyebrow: text(signup.eyebrow),
      title: text(signup.title),
      text: text(signup.text),
      button: signupLink(signup.button),
      note: text(signup.note),
      telegram: link('или напиши мне в Telegram', telegram),
    }),
  }
}

/** Страница главной: блоки по порядку, секции без записей пропущены */
export function homeBlocks(content: Json, mediaOf: MediaOf) {
  const props = blockProps(content, mediaOf)
  const hidden = hiddenSections(content)
  return SECTIONS.filter((section) => !hidden.has(section.id)).map((section) => ({
    id: section.id,
    type: `custom:${section.block}`,
    props: props[section.id],
  }))
}

/** Пункты меню шапки: страницы-секции главной, у которых есть подпись и которые не скрыты */
export function menuItems(content: Json) {
  const hidden = hiddenSections(content)
  return SECTIONS.flatMap((section) =>
    section.menu && !hidden.has(section.id)
      ? [
          {
            label: section.menu,
            // Подпись в меню телефона — как у исходного сайта (mobileLabel в его header.js)
            mobileLabel: 'mobileMenu' in section ? section.mobileMenu : '',
            page: 'index',
            block: section.id,
          },
        ]
      : [],
  )
}

/**
 * Логотип шапки — текстом, как у исходного сайта: знак «Ve» рукописным шрифтом и подпись «Vallex
 * / English» в две строки (brand.mark и brand.tagline). Лера меняет их в админке без SVG
 */
export function headerBrand(content: Json) {
  const brand = record(content.brand)
  const tagline = text(brand.tagline).split('\n').slice(0, 2).join('\n').slice(0, 80)
  return { brand: 'text', logoMark: text(brand.mark).slice(0, 4), logoText: tagline }
}

/** Свой текст подвала — рукописная подпись исходного сайта (footer.sign), до 300 знаков */
export const footerSign = (content: Json) => text(record(content.footer).sign).slice(0, 300)

/** Заголовок окна записи — рукописная надпись над формой оригинала (signup.eyebrow) */
export const windowTitle = (content: Json) =>
  text(record(content.signup).eyebrow).trim().slice(0, 80) || 'Попробуем?'

/** Страница 404 исходного сайта (src/render/not-found.js): «Ой!», заголовок, текст, кнопка */
export const notFoundBlock = {
  id: 'not-found',
  type: 'custom:le-message',
  props: {
    eyebrow: 'Ой!',
    title: 'Такой страницы нет',
    text: 'Возможно, ссылка устарела. Всё самое важное — на главной.',
    button: { label: 'На главную', href: '/' },
  },
}

/** Форма записи: поля и тексты страницы /zapis — как в форме исходного сайта */
export function signupFormProps(content: Json) {
  const signup = record(content.signup)
  return {
    title: text(signup.title).replaceAll('*', '') || 'Запись на пробный урок',
    text:
      [text(signup.text), 'Если тебе нет 14 лет, попроси родителя отправить заявку.']
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 500) || undefined,
    fields: [
      { name: 'name', type: 'name', label: 'Как тебя зовут', required: true },
      {
        name: 'channel',
        type: 'select',
        label: 'Где тебе удобнее общаться',
        required: true,
        // Вид связи — как каналы исходного сайта: по нему сервер проверяет контакт
        options: [
          { label: 'Telegram', contact: 'telegram' },
          { label: 'ВКонтакте', contact: 'vk' },
          { label: 'Телефон', contact: 'phone' },
          { label: 'Почта', contact: 'email' },
        ],
      },
      {
        name: 'contact',
        type: 'text',
        label: 'Как с тобой связаться',
        required: true,
        contactBy: 'channel',
        hint: 'Ник в Telegram, ссылка на страницу ВКонтакте, номер телефона или почта — смотря что выбрано выше.',
      },
    ],
    submitLabel: 'Отправить заявку',
    successText:
      'Заявка у меня. Свяжусь с тобой в течение дня — договоримся о времени первого урока.',
    consentText: 'Даю согласие на обработку персональных данных',
    policyUrl: '/privacy/',
    consentUrl: '/consent/',
  }
}

export type LegalFacts = { operator: string; inn: string; email: string }

export const legalOf = (content: Json): LegalFacts => {
  const legal = record(content.legal)
  return { operator: text(legal.operator), inn: text(legal.inn), email: text(legal.email) }
}

export const seoOf = (content: Json) => {
  const seo = record(content.seo)
  return {
    title: text(seo.title),
    description: text(seo.description),
    shareTitle: text(seo.shareTitle),
    shareDescription: text(seo.shareDescription),
  }
}

export const telegramOf = (content: Json) => text(record(content.contacts).telegram)

export const brandOf = (content: Json) => {
  const brand = record(content.brand)
  return { mark: text(brand.mark), tagline: text(brand.tagline) }
}
