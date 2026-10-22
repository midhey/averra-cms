import { z } from 'zod'
import type { CookieMode } from './cookies'
import { MAIN_PAGE_SLUG, PageContent } from './page'
import { countRu } from './plural'
import type { Organization } from './site-settings'
import { plainTextValue } from './text-body'
import type { VideoProvider } from './video'

// Шаблоны документов сайта: политика конфиденциальности и согласие на обработку персональных
// данных. Это черновик для владельца, а не юридическая гарантия: страница создаётся черновиком с
// пометкой «проверьте с юристом». Текст собирается из фактов установки — реквизитов организации
// (раздел «SEO» → «Организация») и того, что на сайте включено на самом деле: счётчиков, форм,
// уведомлений о заявках на почту и в Telegram, роликов. Значения вставляются одной строкой
// (plainTextValue): разметка блока «Текст» из названия организации не получится

export const LegalDocument = z.enum(['privacy', 'consent'])
export type LegalDocument = z.infer<typeof LegalDocument>

/** Адрес и заголовок страницы каждого документа. Пример формы заявки ссылается на эти адреса */
export const legalPages = {
  privacy: { slug: 'privacy', title: 'Политика конфиденциальности' },
  consent: { slug: 'consent', title: 'Согласие на обработку персональных данных' },
} as const satisfies Record<LegalDocument, { slug: string; title: string }>

/** Блок-пометка шаблона: владелец удаляет его, когда текст проверен */
export const LEGAL_NOTE_BLOCK_ID = 'template-note'

/** Что известно о сайте для текста документа */
export type LegalFacts = {
  siteName: string
  /** Адрес сайта https://домен; null — не задан, в тексте название сайта */
  siteUrl: string | null
  organization: Pick<Organization, 'name' | 'inn' | 'ogrn' | 'email' | 'phone' | 'address'>
  metrika: boolean
  ga4: boolean
  /** Режим cookie-уведомления: согласие до аналитики или только уведомление */
  cookieMode: CookieMode
  /** На страницах сайта есть форма заявки */
  forms: boolean
  /** Заявки уходят получателям в Telegram */
  telegram: boolean
  /**
   * Заявки уходят сотрудникам письмом: канал почты не выключен, и есть получатели на почте или
   * заявку некому везти иначе — тогда её получают владельцы админки
   */
  mail: boolean
  /** Посетителю уходит письмо-подтверждение: оно включено, и в форме есть поле почты */
  visitorConfirmation: boolean
  /** Площадки роликов из блоков «Видео» на страницах сайта */
  video: VideoProvider[]
  /** Сколько дней хранятся заявки (настройки сайта) */
  leadRetentionDays: number
  /** Страница политики из настроек cookie; пусто — адрес шаблона политики (/privacy) */
  policyPage: string
  /** Дата редакции: ГГГГ-ММ-ДД */
  date: string
}

/** Значение или заметная заглушка: владелец увидит, что заполнить */
const valueOr = (value: string, placeholder: string) => {
  const plain = plainTextValue(value)
  return plain === '' ? `[${placeholder}]` : plain
}

const fromSeo = (what: string) => `укажите ${what} в «SEO» → «Организация»`

function operatorOf(facts: LegalFacts) {
  const org = facts.organization
  const address = [org.address.postalCode, org.address.region, org.address.city, org.address.street]
    .map(plainTextValue)
    .filter((part) => part !== '')
    .join(', ')
  return {
    name: valueOr(org.name, fromSeo('название')),
    inn: valueOr(org.inn, fromSeo('ИНН')),
    ogrn: valueOr(org.ogrn, fromSeo('ОГРН')),
    address: valueOr(address, fromSeo('адрес')),
    email: valueOr(org.email, fromSeo('почту')),
  }
}

/** ГГГГ-ММ-ДД → ДД.ММ.ГГГГ */
const russianDate = (date: string) => {
  const [year, month, day] = date.split('-')
  return year && month && day ? `${day}.${month}.${year}` : date
}

const siteOf = (facts: LegalFacts) =>
  facts.siteUrl ? plainTextValue(facts.siteUrl) : `«${valueOr(facts.siteName, 'название сайта')}»`

/** Адрес политики на сайте: выбранная страница или та, что создаст шаблон */
const policyPathOf = (facts: LegalFacts) => {
  const slug = facts.policyPage === '' ? legalPages.privacy.slug : facts.policyPage
  return slug === MAIN_PAGE_SLUG ? '/' : `/${slug}`
}

/**
 * Срок хранения заявок — одной фразой для политики и согласия. Срок хранения резервных копий
 * знает только сервер (BACKUP_KEEP), а не настройки сайта, — его вписывает студия
 */
const leadRetention = (facts: LegalFacts) =>
  `${countRu(facts.leadRetentionDays, ['день', 'дня', 'дней'])} с момента получения заявки, затем она удаляется автоматически; из резервных копий сервера — не позже чем через [укажите срок хранения резервных копий — его знает тот, кто обслуживает сайт] дней после этого`

/** Почтовый сервис: адрес SMTP знает установка, а кто за ним и где он — нет */
const MAIL_SERVICE = '[укажите почтовый сервис, через который сайт отправляет письма, и его страну]'

/** Площадки роликов в политике: кто получает данные, когда посетитель запускает ролик */
const VIDEO_RECIPIENTS: Record<VideoProvider, string> = {
  youtube:
    'YouTube (Google LLC, США) — плеер ролика. Это трансграничная передача персональных данных',
  rutube: 'Rutube (Россия) — плеер ролика',
  vk: 'VK Видео (ООО «ВК», Россия) — плеер ролика',
}

/** Где сервер: шаблон этого не знает — сайт может стоять у любого хостинга */
const SERVER_LOCATION = '[укажите, где находится сервер: страна и хостинг-провайдер]'

const list = (items: string[]) => items.map((item) => `- ${item}`).join('\n')

type Section = { id: string; title?: string; body: string }

const textBlock = ({ id, title, body }: Section) => ({
  id,
  type: 'text' as const,
  props: title ? { title, body } : { body },
})

function documentContent(document: LegalDocument, facts: LegalFacts, sections: Section[]) {
  return PageContent.parse({
    blocks: [
      {
        id: 'title',
        type: 'hero',
        props: {
          variant: 'left',
          title: legalPages[document].title,
          subtitle: `Редакция от ${russianDate(facts.date)}`,
        },
      },
      textBlock({
        id: LEGAL_NOTE_BLOCK_ID,
        title: 'Черновик из шаблона — проверьте с юристом',
        body: 'Этот текст собран автоматически по данным сайта и не заменяет консультацию юриста. Проверьте его, поправьте под то, как вы на самом деле работаете с данными, заполните всё в квадратных скобках и удалите этот блок перед публикацией.',
      }),
      ...sections.map(textBlock),
    ],
  })
}

function privacySections(facts: LegalFacts): Section[] {
  const operator = operatorOf(facts)
  const analytics = facts.metrika || facts.ga4
  const sections: Section[] = [
    {
      id: 'general',
      title: 'Общие положения',
      body: `Эта политика описывает, как ${operator.name} (далее — Оператор) обрабатывает персональные данные посетителей сайта ${siteOf(facts)} и защищает их. Политика составлена по Федеральному закону от 27.07.2006 № 152-ФЗ «О персональных данных».\n\nПользуясь сайтом, вы можете ознакомиться с политикой в любой момент: она опубликована на этой странице.`,
    },
    {
      id: 'operator',
      title: 'Оператор',
      body: list([
        `Наименование: ${operator.name}`,
        `ИНН: ${operator.inn}`,
        `ОГРН: ${operator.ogrn}`,
        `Адрес: ${operator.address}`,
        `Почта для обращений по персональным данным: ${operator.email}`,
      ]),
    },
  ]

  const data: string[] = []
  const purposes: string[] = []
  const grounds: string[] = []
  if (facts.forms) {
    data.push(
      'данные, которые вы указываете в форме заявки: имя, телефон, адрес почты, текст сообщения и другие поля формы',
    )
    purposes.push('ответить на вашу заявку и связаться с вами по ней')
    grounds.push(
      'согласие на обработку персональных данных, которое вы даёте, отмечая флажок в форме заявки',
    )
  }
  if (analytics) {
    data.push(
      'технические данные о посещении: cookie, IP-адрес, сведения о браузере и устройстве, просмотренные страницы и время посещения — их собирают сервисы аналитики',
      'cookie, которая запоминает ваш выбор в уведомлении о cookie (без идентификаторов)',
    )
    purposes.push('понимать, как пользуются сайтом, и делать его удобнее')
    grounds.push(
      facts.cookieMode === 'consent'
        ? 'согласие на аналитические cookie, которое вы даёте в уведомлении о cookie («Принять все» или включённая аналитика в настройках); без него сервисы аналитики на сайте не загружаются'
        : 'согласие на cookie, которое вы выражаете, продолжая пользоваться сайтом после уведомления о cookie',
    )
  }
  if (facts.video.length > 0) {
    data.push(
      'технические данные, которые получает площадка видео, когда вы запускаете ролик на странице: IP-адрес, сведения о браузере и устройстве, cookie площадки',
    )
    purposes.push('показать ролик, который вы запустили')
    grounds.push(
      'ваше согласие, которое вы выражаете, запуская ролик: до нажатия на обложку страница к площадке видео не обращается',
    )
  }
  sections.push({
    id: 'data',
    title: 'Какие данные мы обрабатываем',
    body:
      data.length > 0
        ? `Оператор обрабатывает только те данные, которые нужны для целей ниже:\n\n${list(data)}`
        : 'Сайт не собирает персональные данные посетителей: на нём нет форм заявок, сервисов аналитики и роликов с других площадок.',
  })
  if (purposes.length > 0) {
    sections.push(
      { id: 'purposes', title: 'Зачем', body: list(purposes) },
      {
        id: 'grounds',
        title: 'Основания обработки',
        body: `${list(grounds)}\n\nСогласие можно отозвать в любой момент — см. раздел «Ваши права» ниже.`,
      },
    )
  }

  const recipients: string[] = []
  // Письма уходят через почтовый сервис (SMTP): сотрудникам — с содержимым заявки, посетителю —
  // подтверждение на его адрес
  const mailed = [
    ...(facts.forms && facts.mail
      ? ['письма с уведомлением о заявке и её содержимым приходят сотрудникам Оператора']
      : []),
    ...(facts.forms && facts.visitorConfirmation
      ? ['письмо-подтверждение заявки уходит на адрес почты, который вы указали']
      : []),
  ]
  if (mailed.length > 0) {
    recipients.push(`почтовый сервис ${MAIL_SERVICE} — ${mailed.join('; ')}`)
  }
  if (facts.telegram) {
    recipients.push(
      'Telegram (Telegram FZ-LLC, ОАЭ) — уведомления о заявках с их содержимым приходят сотрудникам Оператора в мессенджер. Это трансграничная передача персональных данных',
    )
  }
  if (facts.metrika) {
    recipients.push('Яндекс Метрика (ООО «Яндекс», Россия) — статистика посещений сайта')
  }
  if (facts.ga4) {
    recipients.push(
      'Google Analytics (Google LLC, США) — статистика посещений сайта. Это трансграничная передача персональных данных',
    )
  }
  for (const provider of facts.video) recipients.push(VIDEO_RECIPIENTS[provider])
  sections.push({
    id: 'recipients',
    title: 'Кому передаются данные',
    body:
      recipients.length > 0
        ? `Оператор не продаёт и не раскрывает данные третьим лицам. Для целей выше данные обрабатывают сервисы:\n\n${list(recipients)}\n\nДругим лицам данные передаются только в случаях, которые прямо предусмотрены законом.`
        : 'Оператор не передаёт персональные данные третьим лицам, кроме случаев, которые прямо предусмотрены законом.',
  })

  // Плеер площадки ставит свои cookie, как только ролик запущен: уведомление о cookie сайта им не
  // управляет — об этом политика говорит отдельно
  const videoCookies =
    'Когда вы запускаете ролик, плеер площадки видео ставит свои cookie по её правилам; до нажатия на обложку страница к площадке не обращается.'
  if (analytics) {
    const body =
      facts.cookieMode === 'consent'
        ? 'Cookie — небольшие файлы, которые сайт сохраняет в браузере. Необходимая cookie запоминает только ваш выбор в уведомлении о cookie и хранится год. Аналитические cookie ставят сервисы аналитики — и только если вы на это согласились.\n\nИзменить выбор можно в любой момент по ссылке «Настройки cookie» внизу страницы или удалив cookie в настройках браузера.'
        : 'Cookie — небольшие файлы, которые сайт сохраняет в браузере. Сервисы аналитики ставят cookie, чтобы считать посещения. Отказаться от cookie можно в настройках браузера: сайт продолжит работать.'
    sections.push({
      id: 'cookies',
      title: 'Cookie',
      body: facts.video.length > 0 ? `${body}\n\n${videoCookies}` : body,
    })
  } else if (facts.video.length > 0) {
    sections.push({
      id: 'cookies',
      title: 'Cookie',
      body: `Cookie — небольшие файлы, которые сайт сохраняет в браузере. Сам сайт cookie не ставит. ${videoCookies} Отказаться от cookie можно в настройках браузера.`,
    })
  }

  // На сервере Оператора лежат только заявки: без форм про сервер и доступ к нему писать нечего
  const storage: string[] = []
  if (facts.forms) {
    storage.push(
      `Заявки хранятся на сервере Оператора (${SERVER_LOCATION}) ${leadRetention(facts)}. Доступ к ним есть только у сотрудников Оператора, которым он нужен для работы.`,
    )
  }
  if (analytics) {
    storage.push('Данные аналитики хранятся у сервисов аналитики по их правилам.')
  }
  if (facts.video.length > 0) {
    storage.push('Данные о просмотре ролика хранятся у площадки видео по её правилам.')
  }
  storage.push('Соединение с сайтом зашифровано (HTTPS).')
  sections.push({ id: 'storage', title: 'Сроки хранения и защита', body: storage.join('\n\n') })

  sections.push(
    {
      id: 'rights',
      title: 'Ваши права',
      body: `Вы можете узнать, какие ваши данные обрабатывает Оператор, потребовать уточнить, заблокировать или удалить их, а также отозвать согласие на обработку. Напишите на ${operator.email} — Оператор ответит в течение 10 рабочих дней.\n\nЕсли вы считаете, что Оператор нарушает ваши права, вы можете обратиться в Роскомнадзор или в суд.`,
    },
    {
      id: 'changes',
      title: 'Изменения политики',
      body: 'Оператор может обновлять политику. Действующая редакция всегда опубликована на этой странице, дата редакции указана в начале.',
    },
  )
  // Номера разделов — по месту: без форм и аналитики части разделов нет
  return sections.map((section, index) => ({ ...section, title: `${index + 1}. ${section.title}` }))
}

function consentSections(facts: LegalFacts): Section[] {
  const operator = operatorOf(facts)
  // Каждая часть — только когда эти письма правда уходят: сотрудникам (mail) и посетителю
  const letters = [
    ...(facts.mail ? ['Письма с заявкой'] : []),
    ...(facts.visitorConfirmation ? ['подтверждение заявки на мою почту'] : []),
  ]
  const lettersText = letters.join(' и ')
  // «Письма…» — множественное число, «подтверждение» одно
  const verb = facts.mail ? 'отправляются' : 'отправляется'
  const transfer = [
    ...(letters.length > 0
      ? [
          `${lettersText.charAt(0).toUpperCase()}${lettersText.slice(1)} ${verb} через почтовый сервис ${MAIL_SERVICE}.`,
        ]
      : []),
    ...(facts.telegram
      ? [
          'Уведомление о заявке с её содержимым приходит сотрудникам Оператора в мессенджер Telegram (Telegram FZ-LLC, ОАЭ). Я согласен на трансграничную передачу моих персональных данных для этой цели.',
        ]
      : []),
  ]
  return [
    {
      id: 'consent',
      body: `Отмечая флажок согласия в форме на сайте ${siteOf(facts)}, я свободно, своей волей и в своём интересе даю согласие ${operator.name} (ИНН ${operator.inn}, ОГРН ${operator.ogrn}, адрес: ${operator.address}; далее — Оператор) на обработку моих персональных данных на условиях ниже.`,
    },
    {
      id: 'terms',
      title: 'Условия',
      body: list([
        'Данные: имя, телефон, адрес электронной почты и другие сведения, которые я укажу в форме.',
        'Цель: ответ на мою заявку и связь со мной по ней.',
        'Действия: сбор, запись, систематизация, накопление, хранение, уточнение, использование, передача (предоставление, доступ), блокирование, удаление и уничтожение — с использованием средств автоматизации и без них.',
        `Срок: ${leadRetention(facts)}. Если я отзову согласие раньше, обработка прекращается после отзыва.`,
        ...transfer,
      ]),
    },
    {
      id: 'withdraw',
      title: 'Отзыв согласия',
      body: `Согласие можно отозвать в любой момент, написав на ${operator.email}. Оператор прекратит обработку и удалит данные в течение 10 рабочих дней, если закон не требует хранить их дольше.\n\nКак Оператор обрабатывает и защищает данные — в политике конфиденциальности на странице ${policyPathOf(facts)}.`,
    },
  ]
}

/** Содержимое страницы документа по фактам сайта. Проходит через схему страницы */
export function legalPageContent(document: LegalDocument, facts: LegalFacts): PageContent {
  const sections = document === 'privacy' ? privacySections(facts) : consentSections(facts)
  return documentContent(document, facts, sections)
}
