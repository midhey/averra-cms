// Логика cookie-уведомления на сайте — без DOM, чтобы её проверяли юнит-тесты. Браузерную часть
// (кнопки, окно, вставка счётчиков) делает consent-dom.ts через порты ConsentPorts. Выбор
// посетителя — одна cookie первой стороны на год: только выбор, без идентификаторов

/** Имя cookie с выбором посетителя */
export const CONSENT_COOKIE = 'averra_consent'

/** Сколько живёт выбор: год, потом сайт спросит снова */
export const CONSENT_MAX_AGE = 365 * 24 * 60 * 60

/**
 * Выбор посетителя: analytics — «Принять все» или аналитика включена в настройках,
 * necessary — «Только необходимые», notice — «Понятно» в режиме «только уведомление»
 */
export type ConsentChoice = 'analytics' | 'necessary' | 'notice'

export type ConsentMode = 'consent' | 'notice'

/** Сервис аналитики в значении cookie: ym — Метрика, ga — GA4 */
export type AnalyticsService = 'ym' | 'ga'

export type ConsentConfig = {
  mode: ConsentMode
  /** Номер счётчика Метрики или пусто */
  metrika: string
  /** Идентификатор потока GA4 или пусто */
  ga4: string
  /** Сайт открыт по https: cookie выбора — с флагом Secure */
  secure: boolean
}

// Те же шаблоны, что у схемы настроек (MetrikaId, Ga4Id): номер уходит в адрес и вызов счётчика,
// поэтому скрипт проверяет его ещё раз, а не верит атрибуту страницы
const METRIKA_ID = /^\d{4,12}$/
const GA4_ID = /^G-[A-Z0-9]{4,16}$/

/** Номера счётчиков, которые прошли проверку. Пусто — счётчика нет */
export function analyticsIds(config: Pick<ConsentConfig, 'metrika' | 'ga4'>) {
  return {
    metrika: METRIKA_ID.test(config.metrika) ? config.metrika : '',
    ga4: GA4_ID.test(config.ga4) ? config.ga4 : '',
  }
}

/** Сервисы аналитики сайта по проверенным номерам — в порядке, в котором их пишет cookie */
export function analyticsServices(ids: { metrika: string; ga4: string }): AnalyticsService[] {
  const services: AnalyticsService[] = []
  if (ids.metrika !== '') services.push('ym')
  if (ids.ga4 !== '') services.push('ga')
  return services
}

/** Значение cookie по имени из document.cookie */
export function cookieValue(cookies: string, name: string) {
  for (const part of cookies.split(';')) {
    const [key, ...rest] = part.split('=')
    if (key?.trim() === name) return rest.join('=').trim()
  }
  return undefined
}

/**
 * Значение cookie: necessary — отказ от всего, без набора; analytics и notice — с набором
 * сервисов, о которых человеку сказали: analytics.ym, notice.ym.ga. Старое значение без набора
 * (до того, как набор появился) — пустой набор
 */
const CHOICE_VALUE = /^(?:necessary|(analytics|notice)((?:\.(?:ym|ga))*))$/

/**
 * Выбор из cookie. Согласие и «Понятно» действуют, только если покрывают все сервисы сайта
 * сейчас: владелец добавил GA4 — согласившиеся на одну Метрику увидят вопрос снова, а не получат
 * GA4 молча. Незнакомое значение — выбора нет: сайт спросит снова
 */
export function readChoice(
  cookies: string,
  services: readonly AnalyticsService[],
): ConsentChoice | undefined {
  const match = CHOICE_VALUE.exec(cookieValue(cookies, CONSENT_COOKIE) ?? '')
  if (!match) return undefined
  const [, kind, list = ''] = match
  if (kind !== 'analytics' && kind !== 'notice') return 'necessary'
  const known = list.split('.').filter(Boolean)
  return services.every((service) => known.includes(service)) ? kind : undefined
}

/** Значение cookie для выбора: у согласия и «Понятно» — сервисы, о которых сказали */
export const choiceValue = (choice: ConsentChoice, services: readonly AnalyticsService[]) =>
  choice === 'necessary' ? choice : [choice, ...services].join('.')

/** Строка для document.cookie: выбор на год на весь сайт */
export function choiceCookie(
  choice: ConsentChoice,
  secure: boolean,
  services: readonly AnalyticsService[],
) {
  return `${CONSENT_COOKIE}=${choiceValue(choice, services)}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`
}

/** Показывать ли уведомление при этом выборе */
export function needsNotice(mode: ConsentMode, choice: ConsentChoice | undefined) {
  // «Понятно» из режима уведомления — не согласие: включили согласие — сайт спросит
  if (mode === 'consent') return choice !== 'analytics' && choice !== 'necessary'
  // Отказ из режима согласия — не ответ на «мы используем cookie»: владелец переключил сайт на
  // уведомление, счётчики уже работают, и отказавшийся должен хотя бы узнать об этом
  return choice !== 'analytics' && choice !== 'notice'
}

/**
 * Следы счётчиков: Метрика (_ym_…), Google Analytics (_ga, _ga_…, _gid, _gat…) и метки рекламы
 * gtag (_gcl_…). Одни и те же префиксы у cookie и ключей localStorage и sessionStorage
 */
const ANALYTICS_KEY = /^(_ym|_ga|_gid|_gat|_gcl)/

/** Имена cookie счётчиков из document.cookie */
export function analyticsCookieNames(cookies: string) {
  return cookies
    .split(';')
    .map((part) => part.split('=')[0]?.trim() ?? '')
    .filter((name) => ANALYTICS_KEY.test(name))
}

/**
 * Ключи хранилища браузера, которые оставили счётчики. Метрика держит _ym_uid и в localStorage и
 * при новом согласии восстановила бы из него прежний идентификатор — стираем и их
 */
export const analyticsStorageKeys = (keys: readonly string[]) =>
  keys.filter((key) => ANALYTICS_KEY.test(key))

/**
 * Домены, на которые счётчик мог поставить cookie: без Domain, сам хост и все его родители
 * (Метрика ставит cookie на домен второго уровня). Стереть cookie можно, только назвав её домен
 */
export function cookieDomains(hostname: string) {
  const parts = hostname.split('.')
  const domains: string[] = ['']
  // IP-адрес и localhost — только сам хост
  if (parts.length < 2 || /^[\d.]+$/.test(hostname))
    return hostname === '' ? domains : ['', hostname]
  for (let index = 0; index < parts.length - 1; index++) {
    domains.push(parts.slice(index).join('.'))
  }
  return domains
}

/** Строки для document.cookie, которые стирают cookie счётчиков на всех доменах */
export function forgetCookies(cookies: string, hostname: string) {
  return analyticsCookieNames(cookies).flatMap((name) =>
    cookieDomains(hostname).map(
      (domain) => `${name}=; Max-Age=0; Path=/${domain === '' ? '' : `; Domain=${domain}`}`,
    ),
  )
}

/** Что контроллер просит у страницы */
export type ConsentPorts = {
  readCookies: () => string
  writeCookie: (cookie: string) => void
  /** Вставить счётчики с этими номерами */
  loadAnalytics: (ids: { metrika: string; ga4: string }) => void
  /**
   * Согласие отозвано, а счётчики уже работают: стереть их cookie и ключи хранилища
   * (forgetCookies, analyticsStorageKeys) и перезагрузить страницу — выгрузить скрипт нельзя
   */
  forgetAnalytics: () => void
  showNotice: () => void
  hideNotice: () => void
  /** Открыть окно настроек; analytics — включён ли переключатель аналитики */
  openSettings: (analytics: boolean) => void
  closeSettings: () => void
}

/**
 * Контроллер уведомления. В режиме согласия счётчики грузятся только после выбора «аналитика»
 * — сейчас или сохранённого раньше; в режиме уведомления их вставляет сама страница
 */
export function createConsent(config: ConsentConfig, ports: ConsentPorts) {
  const ids = analyticsIds(config)
  const services = analyticsServices(ids)
  let choice = readChoice(ports.readCookies(), services)
  let loaded = false

  function load() {
    if (loaded || config.mode !== 'consent' || (ids.metrika === '' && ids.ga4 === '')) return
    loaded = true
    ports.loadAnalytics(ids)
  }

  function choose(next: ConsentChoice) {
    choice = next
    ports.writeCookie(choiceCookie(next, config.secure, services))
    ports.closeSettings()
    ports.hideNotice()
    if (next === 'analytics') {
      load()
    } else if (loaded) {
      loaded = false
      ports.forgetAnalytics()
    }
  }

  return {
    /** Выбор посетителя сейчас */
    get choice() {
      return choice
    },
    /** Счётчики уже вставлены */
    get loaded() {
      return loaded
    },
    /** Страница открылась: счётчики по сохранённому согласию и уведомление, если выбора нет */
    start() {
      if (choice === 'analytics') load()
      if (needsNotice(config.mode, choice)) ports.showNotice()
    },
    /** «Принять все» */
    acceptAll: () => choose(config.mode === 'consent' ? 'analytics' : 'notice'),
    /** «Только необходимые» */
    necessaryOnly: () => choose('necessary'),
    /** «Понятно» в режиме уведомления */
    acknowledge: () => choose('notice'),
    /** «Настроить» в уведомлении или «Настройки cookie» внизу страницы */
    openSettings: () => ports.openSettings(choice === 'analytics'),
    /** «Сохранить выбор» в окне настроек */
    saveSettings: (analytics: boolean) => choose(analytics ? 'analytics' : 'necessary'),
  }
}

export type Consent = ReturnType<typeof createConsent>
