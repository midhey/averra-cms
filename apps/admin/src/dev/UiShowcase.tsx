import {
  contrastMessage,
  defaultTheme,
  HeaderLayout,
  type HeaderTargetPage,
  headerLayoutTitles,
  type MenuItem,
  type ThemeRadius,
  themeContrast,
  themePresets,
  themeRadiusTitles,
} from '@averra/schema'
import { type ReactNode, useId, useState } from 'react'
import { AddBlockDialog } from '../editor/AddBlockDialog'
import {
  type CatalogSection,
  catalog,
  catalogEntry,
  catalogSections,
  sectionTitle,
} from '../editor/catalog'
import { HeaderLayoutSketch, MenuEditor } from '../header/HeaderParts'
import { MediaCard } from '../media/MediaCard'
import { CookieLookSketch } from '../seo/CookieLookSketch'
import { RedirectRows } from '../seo/RedirectRows'
import { SearchSnippet } from '../seo/SearchSnippet'
import { SeoChecks } from '../seo/SeoChecks'
import { SettingsCardActions } from '../seo/SettingsCard'
import { SocialCard } from '../seo/SocialCard'
import type { RedirectRow } from '../seo/seo-format'
import { SiteHeader } from '../shell/SiteHeader'
import { ColorRow, ContrastBadge, ThemeSwatch } from '../theme/ThemeParts'
import {
  AppShell,
  NavLinkContent,
  NavList,
  navLinkClassName,
  SidebarSection,
  SidebarUser,
} from '../ui/AppShell'
import { Button, buttonClassName, IconButton, iconButtonClassName } from '../ui/Button'
import { Card, cardClassName } from '../ui/Card'
import { CountBadge } from '../ui/CountBadge'
import { DataTable } from '../ui/DataTable'
import { Dialog } from '../ui/Dialog'
import { EmptyState } from '../ui/EmptyState'
import { Checkbox, Select, TextArea, TextInput } from '../ui/Field'
import { Icon, iconNames } from '../ui/Icon'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { Facts } from '../ui/Screen'
import { LayoutThumbnail, SegmentedControl } from '../ui/SegmentedControl'
import { StatusPill, type StatusTone } from '../ui/StatusPill'
import { TabList, Tabs } from '../ui/Tabs'
import { usePageTitle } from '../ui/use-page-title'
import styles from './UiShowcase.module.scss'

/**
 * Файл логотипа 120 × 40 для карточки SVG: содержимое картинки, как у загруженного файла, а не
 * оформление админки, поэтому цвета в нём свои. Вытянутый — видно, что превью не обрезано
 */
const SAMPLE_SVG_LOGO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="40" height="40" rx="8" fill="#f60"/><rect x="48" y="12" width="72" height="16" rx="4" fill="#555"/></svg>',
)}`

/**
 * Витрина компонентов (только в разработке, /dev/ui): все состояния в одном месте — для экранов
 * экранов и для проверяющего. Данные выдуманные, в API витрина не ходит
 */

const sections = [
  { id: 'buttons', label: 'Кнопки', icon: 'overview' },
  { id: 'fields', label: 'Поля', icon: 'pages' },
  { id: 'choice', label: 'Выбор', icon: 'check' },
  { id: 'tabs', label: 'Вкладки', icon: 'leads' },
  { id: 'statuses', label: 'Состояния', icon: 'status' },
  { id: 'theme', label: 'Тема сайта', icon: 'palette' },
  { id: 'header', label: 'Шапка и меню', icon: 'header' },
  { id: 'cards', label: 'Карточки и таблица', icon: 'media' },
  { id: 'alerts', label: 'Сообщения', icon: 'info' },
  { id: 'dialog', label: 'Окно', icon: 'mail' },
  { id: 'seo', label: 'SEO', icon: 'search' },
  { id: 'icons', label: 'Иконки', icon: 'settings' },
] as const

const leadFacts = [
  ['Имя', 'Мария Иванова'],
  ['Телефон', '+7 921 777-88-99'],
  ['Комментарий', 'Нужен ремонт ванной, 4 м²'],
] as const

type Page = { title: string; slug: string; tone: StatusTone; state: string; updated: string }

const pages: Page[] = [
  { title: 'Главная', slug: '/', tone: 'warning', state: 'Есть правки', updated: '15 минут назад' },
  { title: 'Цены', slug: '/ceny', tone: 'success', state: 'Опубликована', updated: 'вчера' },
  {
    title: 'Политика конфиденциальности',
    slug: '/privacy',
    tone: 'success',
    state: 'Опубликована',
    updated: '12 октября',
  },
  { title: 'Отзывы', slug: '/otzyvy', tone: 'neutral', state: 'Черновик', updated: '10 октября' },
]

const statuses: Array<[StatusTone, string]> = [
  ['info', 'Новая'],
  ['success', 'Опубликована'],
  ['neutral', 'Черновик'],
  ['warning', 'Есть правки'],
  ['danger', 'Ошибка сборки'],
  ['neutral', 'Обработана'],
]

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={styles.section}>
      <h2 id={`${id}-title`} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  )
}

export function UiShowcase() {
  usePageTitle('Витрина компонентов')
  const [device, setDevice] = useState<'phone' | 'tablet' | 'desktop'>('desktop')
  const [variant, setVariant] = useState<'center' | 'left' | 'split' | 'cover'>('split')
  const [radius, setRadius] = useState<ThemeRadius>('medium')
  const [tab, setTab] = useState<'new' | 'done' | 'all'>('new')
  const [cookieMode, setCookieMode] = useState<'consent' | 'notice'>('consent')
  const [cookieLook, setCookieLook] = useState<'bar' | 'card' | 'modal'>('card')
  const [title, setTitle] = useState('Ремонт квартир под ключ — с фиксированной сметой')
  const [slug, setSlug] = useState('ceny')
  const [consent, setConsent] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [largeOpen, setLargeOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [picked, setPicked] = useState('')
  const [imageSide, setImageSide] = useState<'left' | 'right'>('left')
  const [catalogSection, setCatalogSection] = useState<CatalogSection>('all')
  const [column, setColumn] = useState<'blocks' | 'preview' | 'fields'>('blocks')
  const columnsId = useId()
  const [deleted, setDeleted] = useState(false)
  const [redirects, setRedirects] = useState<RedirectRow[]>([
    { key: 'r1', from: '/old-price', to: '/ceny' },
    { key: 'r2', from: '/ceny', to: '/old-price' },
    { key: 'r3', from: '/uslugi', to: '/' },
  ])

  const sidebar = (
    <>
      {/* Заголовок панели — тот же, что в оболочке админки: сайт у установки один */}
      <SiteHeader name="Ремонт у Ивана" url="https://remont-ivana.ru" />
      <NavList label="Разделы витрины">
        {sections.map((section) => (
          <li key={section.id}>
            <a className={navLinkClassName} href={`#${section.id}`}>
              <NavLinkContent
                icon={section.icon}
                label={section.label}
                badge={section.id === 'tabs' ? { value: 3, label: 'новых: 3' } : undefined}
              />
            </a>
          </li>
        ))}
      </NavList>
      <SidebarSection title="Установка" bottom>
        <NavList label="Установка">
          <li>
            <a className={navLinkClassName} href="#statuses">
              <NavLinkContent
                label="Почта"
                aside={
                  <StatusPill tone="success" appearance="dot">
                    работает
                  </StatusPill>
                }
              />
            </a>
          </li>
          <li>
            <a className={navLinkClassName} href="#statuses">
              <NavLinkContent
                label="Состояние"
                aside={<span className={styles.mono}>v0.9.0</span>}
              />
            </a>
          </li>
        </NavList>
        <SidebarUser name="Алексей Семёнов" roleName="Владелец" />
      </SidebarSection>
    </>
  )

  return (
    <AppShell sidebar={sidebar}>
      <main className={styles.page}>
        <PageHeader
          eyebrow="Только в режиме разработки"
          title="Витрина компонентов"
          meta={
            <>
              <span className={styles.mono}>@averra/ui · frontend-kit f904954</span>
              <StatusPill tone="success" appearance="dot">
                Опубликован 2 часа назад
              </StatusPill>
              <StatusPill tone="warning" appearance="dot">
                Неопубликованные правки на 1 странице
              </StatusPill>
            </>
          }
          actions={
            <>
              <a className={buttonClassName()} href="#fields">
                Новая страница
              </a>
              <Button variant="primary">Опубликовать правки</Button>
            </>
          }
        />

        <Section id="buttons" title="Кнопки">
          <div className={styles.row}>
            <Button variant="primary">Опубликовать</Button>
            <Button>Сохранить</Button>
            <Button variant="ghost" icon="history">
              История
            </Button>
            <Button variant="danger" icon="trash">
              Удалить
            </Button>
          </div>
          <div className={styles.row}>
            <Button variant="primary" size="small">
              Маленькая главная
            </Button>
            <Button size="small" icon="download">
              Скачать CSV
            </Button>
            <Button variant="ghost" size="small">
              Отмена
            </Button>
            <Button variant="danger" size="small">
              Удалить
            </Button>
          </div>
          <div className={styles.row}>
            <Button
              variant="primary"
              loading={saving}
              onClick={() => {
                setSaving(true)
                window.setTimeout(() => setSaving(false), 2000)
              }}
            >
              {saving ? 'Сохраняю…' : 'Сохранить с загрузкой'}
            </Button>
            <Button loading>Идёт проверка</Button>
            <Button variant="primary" disabled>
              Выключена
            </Button>
            <Button disabled>Выключена</Button>
          </div>
          <div className={styles.row}>
            <IconButton label="Назад к сайту" icon="chevron-left" variant="secondary" />
            <IconButton label="Другие действия" icon="menu" />
            <IconButton label="Закрыть" icon="close" size="small" />
            <IconButton label="Открыть сайт" icon="external" variant="secondary" size="small" />
            <IconButton label="Выключена" icon="trash" disabled />
            {/* Число на кнопке: советы SEO страницы. Словами — в подписи для диктора */}
            <IconButton
              label="SEO: 2 совета"
              icon="search"
              variant="secondary"
              badge={<CountBadge count={2} tone="warning" />}
            />
            <Button icon="search">
              SEO
              <CountBadge count={3} tone="danger" />
              <span className="visually-hidden">: 3 совета</span>
            </Button>
            <a className={buttonClassName({ variant: 'ghost', size: 'small' })} href="#cards">
              Ссылка в виде кнопки
              <Icon name="arrow-right" />
            </a>
            {/* Ссылка-иконка: вид IconButton у ссылки («Назад к сайту» в редакторе) */}
            <a
              className={iconButtonClassName({ variant: 'secondary' })}
              href="#buttons"
              aria-label="Ссылка-иконка: к кнопкам"
              title="Ссылка-иконка: к кнопкам"
            >
              <Icon name="chevron-left" />
            </a>
          </div>
        </Section>

        <Section id="fields" title="Поля">
          <div className={styles.grid}>
            <TextArea
              label="Заголовок"
              rows={2}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxChars={120}
              hint="станет h1 страницы"
            />
            <TextInput
              label="Адрес"
              prefix="/"
              mono
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              hint="Латиница в нижнем регистре, цифры и дефис"
            />
            <TextInput
              label="Почта для уведомлений"
              type="email"
              defaultValue="ivan@remont"
              error="Неверный адрес почты"
            />
            <TextInput
              label="Найти страницу"
              hideLabel
              icon="search"
              type="search"
              placeholder="Найти страницу"
            />
            <Select label="Роль" defaultValue="client" hint="Клиент правит черновики">
              <option value="client">Клиент</option>
              <option value="editor">Редактор</option>
            </Select>
            <TextInput label="Выключено" defaultValue="Нельзя изменить" disabled />
            <TextArea
              label="Описание длиннее предела"
              value="Слишком длинное описание страницы, которое не помещается в поиск"
              readOnly
              maxChars={40}
            />
          </div>
          <div className={styles.stack}>
            <Checkbox
              label="Согласие на обработку персональных данных"
              hint="Без отметки форма не отправится"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <Checkbox label="Обязательное поле" error="Отметьте флажок" />
            <Checkbox label="Выключен" disabled defaultChecked />
          </div>
        </Section>

        <Section id="choice" title="Выбор">
          <SegmentedControl
            legend="Ширина предпросмотра"
            options={[
              { value: 'phone', label: 'Телефон' },
              { value: 'tablet', label: 'Планшет' },
              { value: 'desktop', label: 'Десктоп' },
            ]}
            value={device}
            onChange={setDevice}
          />
          {/* С переносом: в узкой колонке — сетка 2×2, подписи целиком (скругления темы) */}
          <div className={styles.narrow}>
            <SegmentedControl
              legend="Скругления"
              wrap
              options={(['none', 'small', 'medium', 'large'] as const).map((value) => ({
                value,
                label: themeRadiusTitles[value],
              }))}
              value={radius}
              onChange={setRadius}
            />
          </div>
          <div className={styles.narrow}>
            <SegmentedControl
              legend="Вариант"
              appearance="cards"
              options={[
                {
                  value: 'left',
                  label: 'Слева',
                  thumbnail: <LayoutThumbnail sketch="left" />,
                },
                {
                  value: 'center',
                  label: 'По центру',
                  thumbnail: <LayoutThumbnail sketch="centered" />,
                },
                {
                  value: 'split',
                  label: 'С картинкой',
                  thumbnail: <LayoutThumbnail sketch="split" />,
                },
                {
                  value: 'cover',
                  label: 'На фото',
                  thumbnail: <LayoutThumbnail sketch="cover" />,
                },
              ]}
              value={variant}
              onChange={setVariant}
            />
          </div>
          <div className={styles.narrow}>
            <SegmentedControl
              legend="Картинка"
              appearance="cards"
              options={(['left', 'right'] as const).map((side) => ({
                value: side,
                label: side === 'left' ? 'Слева' : 'Справа',
                thumbnail: (
                  <LayoutThumbnail sketch={side === 'left' ? 'image-left' : 'image-right'} />
                ),
              }))}
              value={imageSide}
              onChange={setImageSide}
            />
          </div>
          {/* Пилюли с переносом: разделы каталога «Добавить блок» */}
          <SegmentedControl
            legend="Раздел каталога"
            appearance="chips"
            options={catalogSections.map((value) => ({
              value,
              label: value === 'all' ? `Все · ${catalog.length}` : sectionTitle(value),
            }))}
            value={catalogSection}
            onChange={setCatalogSection}
          />
          <div className={styles.narrow}>
            <SegmentedControl
              legend="Режим cookie-уведомления"
              appearance="list"
              options={[
                {
                  value: 'consent',
                  label: 'Согласие до аналитики · рекомендуем',
                  description: 'Метрика и GA подключаются только после «Принять все».',
                },
                {
                  value: 'notice',
                  label: 'Только уведомление',
                  description: 'Аналитика работает сразу, посетитель видит «Понятно».',
                },
              ]}
              value={cookieMode}
              onChange={setCookieMode}
            />
          </div>
          <div className={styles.narrow}>
            <SegmentedControl
              legend="Вид уведомления"
              appearance="cards"
              fill
              options={(['bar', 'card', 'modal'] as const).map((look) => ({
                value: look,
                label: { bar: 'Плашка снизу', card: 'Карточка в углу', modal: 'Окно по центру' }[
                  look
                ],
                thumbnail: <CookieLookSketch look={look} />,
              }))}
              value={cookieLook}
              onChange={setCookieLook}
            />
          </div>
        </Section>

        <Section id="tabs" title="Вкладки">
          <Tabs
            label="Фильтр заявок"
            items={[
              { id: 'new', label: 'Новые', count: 3 },
              { id: 'done', label: 'Обработанные', count: 24 },
              { id: 'all', label: 'Все' },
            ]}
            value={tab}
            onChange={setTab}
          >
            <p className={styles.muted}>
              {
                {
                  new: 'Три новые заявки: Мария, Олег, Анна.',
                  done: 'Обработанные заявки за 180 дней.',
                  all: 'Все заявки сайта.',
                }[tab]
              }
            </p>
          </Tabs>
          {/* Вкладки со своими панелями: так колонки редактора становятся вкладками на телефоне.
              Невыбранная панель — hidden, а не размонтирована */}
          <div className={styles.stack}>
            <TabList
              label="Части редактора (пример)"
              items={[
                { id: 'blocks', label: 'Блоки' },
                { id: 'preview', label: 'Предпросмотр' },
                { id: 'fields', label: 'Поля' },
              ]}
              value={column}
              onChange={setColumn}
              tabId={(id) => `${columnsId}-tab-${id}`}
              panelId={(id) => `${columnsId}-panel-${id}`}
            />
            {(['blocks', 'preview', 'fields'] as const).map((id) => (
              <div
                key={id}
                role="tabpanel"
                id={`${columnsId}-panel-${id}`}
                aria-labelledby={`${columnsId}-tab-${id}`}
                hidden={column !== id}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: панель без фокусируемого по WAI-ARIA — остановка Tab
                tabIndex={0}
                className={styles.muted}
              >
                {
                  {
                    blocks: 'Список блоков страницы.',
                    preview: 'Предпросмотр страницы.',
                    fields: 'Поля выбранного блока.',
                  }[id]
                }
              </div>
            ))}
          </div>
        </Section>

        <Section id="statuses" title="Состояния">
          <div className={styles.row}>
            {statuses.map(([tone, label]) => (
              <StatusPill key={label} tone={tone}>
                {label}
              </StatusPill>
            ))}
          </div>
          <div className={styles.row}>
            <StatusPill tone="success" appearance="dot">
              работает
            </StatusPill>
            <StatusPill tone="warning" appearance="dot">
              письма не уходят
            </StatusPill>
            <StatusPill tone="danger" appearance="dot">
              бэкап не удался
            </StatusPill>
            <StatusPill tone="info" appearance="dot">
              идёт сборка
            </StatusPill>
            <StatusPill tone="neutral" appearance="dot">
              не настроено
            </StatusPill>
          </div>
        </Section>

        <Section id="theme" title="Тема сайта">
          <ThemeShowcase />
        </Section>

        <Section id="header" title="Шапка и меню">
          <HeaderShowcase />
        </Section>

        <Section id="cards" title="Карточки и таблица">
          <div className={styles.stats}>
            <a className={cardClassName({ interactive: true })} href="#tabs">
              <span className={styles.statLabel}>Новые заявки</span>
              <span className={styles.statFigure}>3</span>
              <span className={styles.statLink}>Разобрать →</span>
            </a>
            <Card>
              <span className={styles.statLabel}>Страницы</span>
              <span className={styles.statFigure}>4</span>
              <span className={styles.statLabel}>3 опубликованы, 1 черновик</span>
            </Card>
            <Card>
              <span className={styles.statLabel}>Последняя сборка</span>
              <span className={styles.statValue}>Успешно, 41 с</span>
              <span className={styles.statLabel}>сегодня в 12:14</span>
            </Card>
            <Card>
              <span className={styles.statLabel}>Бэкап</span>
              <span className={styles.statValue}>Ночью, 03:00</span>
              <span className={styles.statLabel}>хранится 14 копий</span>
            </Card>
          </div>
          {/* Выбранная карточка-ссылка (aria-current), как заявка в списке рядом с карточкой. В
              принудительных цветах её отличает обводка: цвет рамки там не различить */}
          <ul className={styles.picks} aria-label="Заявки в списке">
            <li>
              <a
                className={cardClassName({ padding: 'compact', interactive: true })}
                href="#cards"
                aria-current="page"
              >
                <span className={styles.statLabel}>Главная · 5 минут назад</span>
                <span className={styles.pickName}>Мария Иванова</span>
              </a>
            </li>
            <li>
              <a className={cardClassName({ padding: 'compact', interactive: true })} href="#cards">
                <span className={styles.statLabel}>Цены · вчера</span>
                <span className={styles.pickName}>Пётр Смирнов</span>
              </a>
            </li>
          </ul>
          {/* Сведения раскладываются по ширине своего списка, а не окна: в широкой карточке —
              в две колонки, в узкой (карточка заявки рядом со списком на 1024 px) — столбиком */}
          <div className={styles.factsRow}>
            <Card>
              <Facts label="Сведения в широкой карточке" items={leadFacts} />
            </Card>
            <Card className={styles.narrowCard}>
              <Facts label="Сведения в узкой карточке" items={leadFacts} />
            </Card>
          </div>
          <DataTable
            caption="Страницы сайта"
            columns={[
              {
                key: 'title',
                header: 'Страница',
                cell: (page) => <a href="#cards">{page.title}</a>,
              },
              { key: 'slug', header: 'Адрес', mono: true, cell: (page) => page.slug },
              {
                key: 'state',
                header: 'Состояние',
                cell: (page) => <StatusPill tone={page.tone}>{page.state}</StatusPill>,
              },
              { key: 'updated', header: 'Изменена', muted: true, cell: (page) => page.updated },
            ]}
            rows={pages}
            rowKey={(page) => page.slug}
          />
          <DataTable
            caption="Заявки"
            columns={[{ key: 'name', header: 'Имя', cell: (row: { name: string }) => row.name }]}
            rows={[]}
            rowKey={(row) => row.name}
            empty={
              <EmptyState title="Заявок пока нет" icon="leads">
                Они появятся, когда посетитель отправит форму на опубликованном сайте.
              </EmptyState>
            }
          />
        </Section>

        <Section id="alerts" title="Сообщения">
          <InlineAlert tone="info" title="Сайт собирается">
            Обычно это меньше минуты. Страница обновится сама.
          </InlineAlert>
          <InlineAlert tone="success" live>
            Настройки почты сохранены (итог действия — role="status").
          </InlineAlert>
          <InlineAlert tone="warning" title="Ссылки в письмах ведут на localhost">
            Задайте ADMIN_URL с адресом админки.
          </InlineAlert>
          <InlineAlert
            tone="danger"
            title="Не вышло сохранить"
            action={<Button size="small">Повторить</Button>}
          >
            API не отвечает. Правки на месте, попробуйте ещё раз.
          </InlineAlert>
        </Section>

        <Section id="dialog" title="Окно">
          <div className={styles.row}>
            <Button variant="danger" icon="trash" onClick={() => setDialogOpen(true)}>
              Удалить страницу…
            </Button>
            <Button onClick={() => setLargeOpen(true)}>Большое окно…</Button>
            <Button icon="plus" onClick={() => setCatalogOpen(true)}>
              Каталог блоков…
            </Button>
            <p className={styles.muted} aria-live="polite">
              {deleted ? 'Страница «Отзывы» удалена (понарошку).' : ''}
              {picked ? `Выбран блок «${picked}» (понарошку).` : ''}
            </p>
          </div>
          {/* Самое широкое окно — настоящий каталог редактора: поиск, разделы, наброски, «новый» */}
          <AddBlockDialog
            open={catalogOpen}
            onClose={() => setCatalogOpen(false)}
            onPick={(type) => {
              setPicked(catalogEntry(type).title)
              setCatalogOpen(false)
            }}
            after={null}
          />
          <Dialog
            open={largeOpen}
            onClose={() => setLargeOpen(false)}
            size="large"
            title="Добавить блок"
            description="Большое окно — как каталог «Добавить блок» в редакторе."
          >
            <ul className={styles.icons}>
              {['Первый экран', 'Преимущества', 'Цены', 'Отзывы', 'Форма заявки'].map((name) => (
                <li key={name} className={cardClassName({ padding: 'compact' })}>
                  {name}
                </li>
              ))}
            </ul>
          </Dialog>
          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title="Удалить страницу «Отзывы»?"
            description="Черновик и история удалятся. На сайте страница пропадёт после публикации."
            footer={
              <>
                <Button onClick={() => setDialogOpen(false)}>Отмена</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setDeleted(true)
                    setDialogOpen(false)
                  }}
                >
                  Удалить
                </Button>
              </>
            }
          >
            <TextInput label="Причина (необязательно)" />
          </Dialog>
        </Section>

        <Section id="seo" title="SEO">
          <div className={styles.grid}>
            <MediaCard
              meta="Картинка не выбрана"
              action={<Button size="small">Выбрать картинку</Button>}
            />
            <MediaCard
              name="logo-remont.png"
              meta="512 × 512 · AVIF, WebP, PNG"
              square
              action={<Button size="small">Заменить</Button>}
            />
            <MediaCard
              meta="Этой картинки нет в медиатеке сайта"
              invalid
              action={<Button size="small">Заменить</Button>}
            />
            {/* Только просмотр (клиент на экране шапки): без кнопки выбора */}
            <MediaCard name="logo-remont.png" meta="512 × 512 · AVIF, WebP, PNG" square />
            {/* Логотип из SVG: формат в подписи, превью — сам файл */}
            <MediaCard
              thumbnail={SAMPLE_SVG_LOGO}
              whole
              name="logo-remont.svg"
              meta="120 × 40 · SVG"
              action={<Button size="small">Заменить</Button>}
            />
            <SearchSnippet
              address="remont-ivana.ru › ceny"
              title="Цены — Ремонт у Ивана"
              description="Ремонт квартир под ключ в Твери: фиксированная смета, свои бригады и гарантия 3 года."
            />
            <SearchSnippet address="remont-ivana.ru" title="Ремонт у Ивана" description="" />
            {/* SEO страницы в редакторе: строка Яндекса и Google с обрезкой по их пределам */}
            <SearchSnippet
              engine="yandex"
              address="remont-ivana.ru › ceny"
              title="Цены на ремонт квартир под ключ в Твери: смета за день, цена в договоре и гарантия"
              description="Ремонт квартир под ключ в Твери: фиксированная смета, свои бригады и гарантия 3 года. Приезжаем на замер бесплатно и на следующий день присылаем подробную смету по каждой комнате."
            />
            <SearchSnippet
              engine="google"
              siteName="Ремонт у Ивана"
              address="remont-ivana.ru › ceny"
              title="Цены на ремонт квартир под ключ в Твери: смета за день, цена в договоре и гарантия"
              description="Ремонт квартир под ключ в Твери: фиксированная смета, свои бригады и гарантия 3 года. Приезжаем на замер бесплатно и на следующий день присылаем подробную смету по каждой комнате."
            />
            <SocialCard
              domain="remont-ivana.ru"
              title="Цены на ремонт квартир"
              description="Фиксированная смета, свои бригады и гарантия 3 года."
              imageNote="без адреса сайта картинки нет"
            />
            <SeoChecks
              checks={[
                {
                  id: 'description',
                  level: 'problem',
                  title: 'Описания нет',
                  advice: 'Поисковик возьмёт кусок текста со страницы сам, часто неудачный.',
                },
                {
                  id: 'title',
                  level: 'warning',
                  title: 'Заголовок 64 символа: Google может обрезать',
                  advice: 'Google показывает около 60 символов, Яндекс — чуть больше.',
                },
                {
                  id: 'h1',
                  level: 'good',
                  title: 'Главный заголовок (h1) один: «Ремонт под ключ»',
                },
                { id: 'alt', level: 'good', title: 'У всех картинок есть описание (alt)' },
              ]}
            />
          </div>
          {/* Кнопки карточки раздела: всё сохранено и есть несохранённые правки */}
          <div className={styles.row}>
            <SettingsCardActions saveLabel="Сохранить" pending={false} unsaved={false} />
            <SettingsCardActions saveLabel="Сохранить редиректы" pending={false} unsaved />
          </div>
          <RedirectRows
            rows={redirects}
            names={(row) => ({ from: `${row.key}.from`, to: `${row.key}.to` })}
            error={(name) =>
              name === 'r2.to'
                ? 'Петля: цепочка редиректов от /ceny возвращается на /ceny'
                : undefined
            }
            warning={(row) =>
              row.from === '/uslugi'
                ? 'По этому адресу есть страница «Услуги»: редирект не сработает. Удалите строку или страницу'
                : undefined
            }
            onChange={(key, part, value) =>
              setRedirects((rows) =>
                rows.map((row) => (row.key === key ? { ...row, [part]: value } : row)),
              )
            }
            onRemove={(key) => setRedirects((rows) => rows.filter((row) => row.key !== key))}
            onAdd={() =>
              setRedirects((rows) => [...rows, { key: `r${Date.now()}`, from: '', to: '' }])
            }
          />
          <InlineAlert tone="warning" title="Сайт скрыт от поисковиков">
            Так и задумано, пока сайт делают. Перед запуском снимите флажок.
          </InlineAlert>
        </Section>

        <Section id="icons" title="Иконки">
          <ul className={styles.icons}>
            {iconNames.map((name) => (
              <li key={name} className={styles.iconItem}>
                <Icon name={name} />
                <span className={styles.mono}>{name}</span>
              </li>
            ))}
          </ul>
        </Section>
      </main>
    </AppShell>
  )
}

/**
 * Тема сайта: отметки контраста (ок, мало у блокирующей пары — ошибка, мало у пары-предупреждения
 * — предупреждение), строки цвета с ошибкой и без проверки, миниатюры готовых тем
 */
function ThemeShowcase() {
  const checks = themeContrast({ ...defaultTheme.colors, accent: '#ffe066' })
  const [accent, setAccent] = useState('#ffe066')
  const accentCheck = themeContrast({
    ...defaultTheme.colors,
    accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#ffe066',
  }).find((check) => check.id === 'accent-background')
  return (
    <>
      <div className={styles.row}>
        {checks
          .filter((check) => ['text-background', 'accent-background'].includes(check.id))
          .map((check) => (
            <ContrastBadge key={check.id} check={check} />
          ))}
        {/* Пар-предупреждений в теме сейчас нет, но отметка их умеет: тон решает blocking */}
        {checks
          .filter((check) => check.id === 'accent-surface')
          .map((check) => (
            <ContrastBadge key={check.id} check={{ ...check, blocking: false }} />
          ))}
      </div>
      <div className={styles.themeRows}>
        <ColorRow
          colorRole="accent"
          title="Акцент (кнопки, ссылки)"
          value={accent}
          swatch={/^#[0-9a-f]{6}$/i.test(accent) ? accent : '#ffe066'}
          check={accentCheck}
          error={accentCheck && !accentCheck.ok ? contrastMessage(accentCheck) : undefined}
          disabled={false}
          onChange={setAccent}
        />
        <ColorRow
          colorRole="border"
          title="Линии и рамки"
          value={defaultTheme.colors.border}
          swatch={defaultTheme.colors.border}
          check={undefined}
          error={undefined}
          disabled
          onChange={() => {}}
        />
      </div>
      <div className={styles.row}>
        {themePresets.map((preset) => (
          <span key={preset.id} className={styles.themeSwatch}>
            <ThemeSwatch theme={preset.theme} />
          </span>
        ))}
      </div>
    </>
  )
}

const showcasePages: HeaderTargetPage[] = [
  {
    slug: 'index',
    title: 'Ремонт квартир',
    published: true,
    hideHeader: false,
    hideFooter: false,
    overlay: false,
    blocks: [
      { id: 'pricing-1', type: 'pricing', label: 'Цены', draft: true, published: true },
      { id: 'form-1', type: 'form', label: 'Заявка', draft: true, published: false },
    ],
  },
  {
    slug: 'raboty',
    title: 'Работы',
    published: false,
    hideHeader: false,
    hideFooter: false,
    overlay: false,
    blocks: [],
  },
]

/**
 * Шапка: миниатюры четырёх раскладок и редактор меню — пункт с ошибкой, пункт с предупреждением
 * (цель не опубликована) и обычный; перестановка ручкой и стрелками работает
 */
function HeaderShowcase() {
  const [layout, setLayout] = useState<HeaderLayout>('classic')
  const [menu, setMenu] = useState<readonly MenuItem[]>([
    { label: 'Цены', page: 'index', block: 'pricing-1' },
    { label: 'Работы', page: 'raboty' },
    { label: '', page: 'index', block: 'form-1' },
  ])
  return (
    <>
      <SegmentedControl
        legend="Раскладка шапки"
        appearance="cards"
        columns={2}
        options={HeaderLayout.options.map((value) => ({
          value,
          label: headerLayoutTitles[value],
          thumbnail: <HeaderLayoutSketch layout={value} />,
        }))}
        value={layout}
        onChange={setLayout}
      />
      <MenuEditor
        items={menu}
        pages={showcasePages}
        errors={menu[2]?.label === '' ? { 'menu.2.label': 'Обязательное поле' } : {}}
        warnings={
          new Map([
            [
              1,
              'Пункт меню «Работы»: страница «Работы» не опубликована — опубликуйте её или выберите другую',
            ],
          ])
        }
        onChange={setMenu}
      />
    </>
  )
}
