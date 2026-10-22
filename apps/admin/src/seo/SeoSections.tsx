import {
  cookieModeTitles,
  OrganizationType,
  organizationTypeTitles,
  SEO_DESCRIPTION_MAX,
  SEO_DESCRIPTION_RECOMMENDED,
  SITE_NAME_MAX,
  type SiteLanguage,
  type SiteSettings,
  siteLanguages,
} from '@averra/schema'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { MediaPickField } from '../media/MediaPickField'
import { buttonClassName } from '../ui/Button'
import { Checkbox, Select, TextArea, TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { SearchSnippet } from './SearchSnippet'
import { SettingsCard } from './SettingsCard'
import {
  parseSocials,
  SAMPLE_PAGE_TITLE,
  snippetAddress,
  socialsText,
  titleExample,
} from './seo-format'
import { type SettingsView, useSettingsForm } from './use-settings-form'

type SectionProps = { siteId: string; view: SettingsView }

const languageEntries = Object.entries(siteLanguages) as [
  SiteLanguage,
  (typeof siteLanguages)[SiteLanguage],
][]

/** Название, шаблон заголовка, описание, язык, адрес и картинка для соцсетей */
export function GeneralSection({ siteId, view }: SectionProps) {
  const initial = (settings: SiteSettings) => ({
    name: settings.name,
    titleTemplate: settings.titleTemplate,
    description: settings.description,
    language: settings.language,
    url: settings.url,
    ogImage: settings.ogImage,
  })
  const [values, setValues] = useState(() => initial(view.settings))
  const form = useSettingsForm({
    siteId,
    patch: values,
    done: 'Основное сохранено. Сайт пересобирается',
    onSaved: (settings) => setValues(initial(settings)),
  })
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    form.clear(key)
  }

  return (
    <SettingsCard
      id="general"
      title="Основное"
      description="Как сайт называется и как его видят поисковики и соцсети."
      form={form}
    >
      <TextInput
        label="Название сайта"
        name="name"
        value={values.name}
        maxChars={SITE_NAME_MAX}
        onChange={(event) => set('name', event.target.value)}
        error={form.error('name')}
        hint="Видно в админке, в соцсетях (og:site_name) и в манифесте сайта"
      />
      <TextInput
        label="Шаблон заголовка страницы"
        name="titleTemplate"
        value={values.titleTemplate}
        maxChars={120}
        placeholder={`%s — ${values.name}`}
        onChange={(event) => set('titleTemplate', event.target.value)}
        error={form.error('titleTemplate')}
        hint={
          <>
            %s — заголовок страницы. Страница «{SAMPLE_PAGE_TITLE}» во вкладке и в поиске: «
            {titleExample(values.titleTemplate)}». На главной — её заголовок как есть. Пусто —
            заголовки без шаблона
          </>
        }
      />
      <TextArea
        label="Описание по умолчанию"
        name="description"
        rows={3}
        value={values.description}
        maxChars={SEO_DESCRIPTION_MAX}
        onChange={(event) => set('description', event.target.value)}
        error={form.error('description')}
        hint={`Для страниц без своего описания. Поисковик покажет около ${SEO_DESCRIPTION_RECOMMENDED} символов — главное в начале`}
      />
      <SearchSnippet
        address={snippetAddress(values.url, view.installationUrl, '/ceny/')}
        title={titleExample(values.titleTemplate)}
        description={values.description}
      />
      <Select
        label="Язык сайта"
        name="language"
        value={values.language}
        onChange={(event) => set('language', event.target.value as SiteLanguage)}
        error={form.error('language')}
        hint="Атрибут lang страниц: по нему поисковик и экранный диктор понимают язык"
      >
        {languageEntries.map(([code, language]) => (
          <option key={code} value={code}>
            {language.title}
          </option>
        ))}
      </Select>
      <TextInput
        label="Адрес сайта"
        name="url"
        mono
        inputMode="url"
        value={values.url}
        placeholder={view.installationUrl ?? 'https://example.ru'}
        onChange={(event) => set('url', event.target.value)}
        error={form.error('url')}
        hint={
          view.installationUrl
            ? `Канонический адрес для поисковиков и соцсетей. Пусто — адрес установки ${view.installationUrl}`
            : 'Канонический адрес для поисковиков и соцсетей, https:// и домен. Без него нет canonical и карты сайта'
        }
      />
      <MediaPickField
        siteId={siteId}
        label="Картинка для соцсетей"
        name="ogImage"
        value={values.ogImage}
        onChange={(mediaId) => set('ogImage', mediaId)}
        error={form.error('ogImage')}
        hint="Её покажут VK, Telegram и мессенджеры, когда делятся ссылкой. JPEG или PNG, лучше 1200 × 630"
      />
    </SettingsCard>
  )
}

/** Скрыть сайт от поисковиков: robots.txt и noindex на всех страницах */
export function IndexingSection({ siteId, view }: SectionProps) {
  const [hidden, setHidden] = useState(view.settings.hideFromSearch)
  const form = useSettingsForm({
    siteId,
    patch: { hideFromSearch: hidden },
    done: hidden
      ? 'Сайт скрыт от поисковиков. Сайт пересобирается'
      : 'Сайт открыт поисковикам. Сайт пересобирается',
    onSaved: (settings) => setHidden(settings.hideFromSearch),
  })
  const saved = view.settings.hideFromSearch

  return (
    <SettingsCard
      id="indexing"
      title="Индексация"
      description="Пускать ли поисковики на сайт. Карта сайта и robots.txt собираются сами из опубликованных страниц."
      form={form}
    >
      {saved && (
        <InlineAlert tone="warning" title="Сайт скрыт от поисковиков">
          Новый сайт скрыт, пока его делают. Когда сайт готов к запуску, снимите флажок и сохраните
          — иначе его не найдут в поиске.
        </InlineAlert>
      )}
      <Checkbox
        name="hideFromSearch"
        checked={hidden}
        onChange={(event) => setHidden(event.target.checked)}
        label="Скрыть сайт от поисковиков"
        hint="robots.txt закрывает весь сайт, на каждой странице — noindex, nofollow, карта сайта пустая. Для недоделанного и тестового сайта"
      />
      {view.url && (
        <p>
          Сейчас на сайте:{' '}
          <a href={`${view.url}/robots.txt`} target="_blank" rel="noreferrer">
            robots.txt
          </a>{' '}
          и{' '}
          <a href={`${view.url}/sitemap.xml`} target="_blank" rel="noreferrer">
            sitemap.xml
          </a>
          . Скрыть одну страницу можно в её редакторе: кнопка «SEO».
        </p>
      )}
    </SettingsCard>
  )
}

/** Иконка сайта: favicon и иконки для телефонов из одной картинки */
export function IconSection({ siteId, view }: SectionProps) {
  const [icon, setIcon] = useState(view.settings.icon)
  const form = useSettingsForm({
    siteId,
    patch: { icon },
    done: 'Иконка сохранена. Сайт пересобирается',
    onSaved: (settings) => setIcon(settings.icon),
  })
  return (
    <SettingsCard
      id="icon"
      title="Иконка сайта"
      description="Во вкладке браузера, в закладках и на экране телефона."
      form={form}
    >
      <MediaPickField
        siteId={siteId}
        label="Иконка"
        name="icon"
        square
        value={icon}
        onChange={(mediaId) => {
          setIcon(mediaId)
          form.clear('icon')
        }}
        error={form.error('icon')}
        hint="Квадратная картинка от 512 × 512, лучше PNG с прозрачным фоном. Из неё сайт получит favicon.ico, иконку для iPhone и Android. SVG медиатека не принимает"
      />
    </SettingsCard>
  )
}

/** Коды подтверждения прав: Яндекс Вебмастер и Google Search Console */
export function VerificationSection({ siteId, view }: SectionProps) {
  const [values, setValues] = useState(view.settings.verification)
  const form = useSettingsForm({
    siteId,
    patch: { verification: values },
    done: 'Коды сохранены. Когда сайт пересоберётся, нажмите «Проверить» в Вебмастере или Search Console',
    onSaved: (settings) => setValues(settings.verification),
  })
  const set = (key: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    form.clear(`verification.${key}`)
  }
  return (
    <SettingsCard
      id="verification"
      title="Проверка в поисковиках"
      description="Подтвердите права на сайт, чтобы видеть его в Яндекс Вебмастере и Google Search Console. Способ — «Мета-тег»."
      form={form}
    >
      <TextInput
        label="Яндекс Вебмастер"
        name="verification.yandex"
        mono
        value={values.yandex}
        onChange={(event) => set('yandex', event.target.value)}
        error={form.error('verification.yandex')}
        hint='Код из мета-тега yandex-verification или весь тег целиком — возьмём код из content="…"'
      />
      <TextInput
        label="Google Search Console"
        name="verification.google"
        mono
        value={values.google}
        onChange={(event) => set('google', event.target.value)}
        error={form.error('verification.google')}
        hint="Код из мета-тега google-site-verification или весь тег целиком"
      />
    </SettingsCard>
  )
}

/** Счётчики: Яндекс Метрика и Google Analytics 4 — единственный JS на сайте */
export function AnalyticsSection({ siteId, view }: SectionProps) {
  const [values, setValues] = useState(view.settings.analytics)
  const form = useSettingsForm({
    siteId,
    patch: { analytics: values },
    done: 'Счётчики сохранены. Сайт пересобирается',
    onSaved: (settings) => setValues(settings.analytics),
  })
  const set = (key: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    form.clear(`analytics.${key}`)
  }
  return (
    <SettingsCard
      id="analytics"
      title="Аналитика"
      description="Сайт работает без JavaScript. Счётчик и cookie-уведомление к нему — единственные скрипты, которые на него попадут, и только если вы задали номер."
      form={form}
    >
      <InlineAlert
        tone="info"
        title={`Cookie: ${cookieModeTitles[view.settings.cookies.mode].toLowerCase()}`}
        action={
          <Link to="/seo/cookies" className={buttonClassName({ size: 'small' })}>
            Cookie и согласие
          </Link>
        }
      >
        {view.settings.cookies.mode === 'consent'
          ? 'Счётчики загрузятся только у посетителей, которые согласились на аналитику в уведомлении о cookie.'
          : 'Счётчики работают сразу, посетитель видит уведомление о cookie.'}
      </InlineAlert>
      <TextInput
        label="Номер счётчика Яндекс Метрики"
        name="analytics.metrika"
        mono
        inputMode="numeric"
        value={values.metrika}
        onChange={(event) => set('metrika', event.target.value)}
        error={form.error('analytics.metrika')}
        hint="Только цифры, например 98765432. Вебвизор выключен: он записывает, что вводят в форму"
      />
      <TextInput
        label="Google Analytics 4"
        name="analytics.ga4"
        mono
        value={values.ga4}
        onChange={(event) => set('ga4', event.target.value)}
        error={form.error('analytics.ga4')}
        hint="Идентификатор потока вида G-XXXXXXXXXX"
      />
      <InlineAlert tone="info" title="Цель «Заявка с формы»">
        После отправки формы посетитель возвращается на ту же страницу с параметром sent в адресе. В
        Метрике создайте цель «Посещение страниц» с условием «URL: содержит» — sent=.
      </InlineAlert>
    </SettingsCard>
  )
}

/** Организация для разметки на главной: название, контакты, адрес, соцсети, реквизиты */
export function OrganizationSection({ siteId, view }: SectionProps) {
  const initial = (settings: SiteSettings) => {
    const { socials, ...rest } = settings.organization
    return { ...rest, socials: socialsText(socials) }
  }
  const [values, setValues] = useState(() => initial(view.settings))
  const form = useSettingsForm({
    siteId,
    patch: { organization: { ...values, socials: parseSocials(values.socials) } },
    done: 'Организация сохранена. Сайт пересобирается',
    onSaved: (settings) => setValues(initial(settings)),
  })
  type Values = typeof values
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    form.clear(`organization.${key}`)
  }
  const setAddress = (key: keyof Values['address'], value: string) => {
    setValues((current) => ({ ...current, address: { ...current.address, [key]: value } }))
    form.clear(`organization.address.${key}`)
  }
  const text = (key: 'name' | 'phone' | 'email' | 'inn' | 'ogrn') => ({
    name: `organization.${key}`,
    value: values[key],
    onChange: (event: { target: { value: string } }) => set(key, event.target.value),
    error: form.error(`organization.${key}`),
  })
  const address = (key: keyof Values['address']) => ({
    name: `organization.address.${key}`,
    value: values.address[key],
    onChange: (event: { target: { value: string } }) => setAddress(key, event.target.value),
    error: form.error(`organization.address.${key}`),
  })

  return (
    <SettingsCard
      id="organization"
      title="Организация"
      description="Разметка schema.org на главной: по ней поисковик показывает контакты и связывает сайт с компанией. Пустое название — разметки нет."
      form={form}
    >
      <Select
        label="Вид"
        name="organization.type"
        value={values.type}
        onChange={(event) => set('type', OrganizationType.parse(event.target.value))}
      >
        {OrganizationType.options.map((type) => (
          <option key={type} value={type}>
            {organizationTypeTitles[type]}
          </option>
        ))}
      </Select>
      <TextInput label="Название" maxChars={200} {...text('name')} />
      <MediaPickField
        siteId={siteId}
        label="Логотип"
        name="organization.logo"
        value={values.logo}
        onChange={(mediaId) => set('logo', mediaId)}
        error={form.error('organization.logo')}
      />
      <TextInput label="Телефон" type="tel" placeholder="+7 900 123-45-67" {...text('phone')} />
      <TextInput label="Почта" type="email" placeholder="info@example.ru" {...text('email')} />
      <TextInput label="Улица и дом" {...address('street')} />
      <TextInput label="Город" {...address('city')} />
      <TextInput label="Регион" {...address('region')} />
      <TextInput label="Индекс" inputMode="numeric" {...address('postalCode')} />
      <TextArea
        label="Соцсети"
        name="organization.socials"
        rows={3}
        mono
        value={values.socials}
        onChange={(event) => set('socials', event.target.value)}
        error={form.error('organization.socials')}
        hint="Ссылки https:// по одной в строке: VK, Telegram, Дзен — до 10"
      />
      <TextInput
        label="ИНН"
        inputMode="numeric"
        {...text('inn')}
        hint="Необязательно. 10 цифр у организации, 12 у ИП"
      />
      <TextInput
        label="ОГРН или ОГРНИП"
        inputMode="numeric"
        {...text('ogrn')}
        hint="Необязательно. 13 или 15 цифр"
      />
    </SettingsCard>
  )
}
