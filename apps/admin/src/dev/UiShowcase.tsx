import { type ReactNode, useId, useState } from 'react'
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
import { DataTable } from '../ui/DataTable'
import { Dialog } from '../ui/Dialog'
import { EmptyState } from '../ui/EmptyState'
import { Checkbox, Select, TextArea, TextInput } from '../ui/Field'
import { Icon, iconNames } from '../ui/Icon'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { LayoutThumbnail, SegmentedControl } from '../ui/SegmentedControl'
import { StatusPill, type StatusTone } from '../ui/StatusPill'
import { TabList, Tabs } from '../ui/Tabs'
import { usePageTitle } from '../ui/use-page-title'
import styles from './UiShowcase.module.scss'

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
  { id: 'cards', label: 'Карточки и таблица', icon: 'media' },
  { id: 'alerts', label: 'Сообщения', icon: 'info' },
  { id: 'dialog', label: 'Окно', icon: 'mail' },
  { id: 'icons', label: 'Иконки', icon: 'settings' },
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
  const [variant, setVariant] = useState<'center' | 'left' | 'split'>('split')
  const [tab, setTab] = useState<'new' | 'done' | 'all'>('new')
  const [title, setTitle] = useState('Ремонт квартир под ключ — с фиксированной сметой')
  const [slug, setSlug] = useState('ceny')
  const [consent, setConsent] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [largeOpen, setLargeOpen] = useState(false)
  const [column, setColumn] = useState<'blocks' | 'preview' | 'fields'>('blocks')
  const columnsId = useId()
  const [deleted, setDeleted] = useState(false)

  const sidebar = (
    <>
      <button type="button" className={styles.siteSwitch}>
        <span className={styles.siteSwitchText}>
          <span className={styles.siteName}>Ремонт у Ивана</span>
          <span className={styles.siteDomain}>remont-ivana.ru</span>
        </span>
        <Icon name="chevron-down" />
        <span className="visually-hidden">: выбрать сайт</span>
      </button>
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
              ]}
              value={variant}
              onChange={setVariant}
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
            <p className={styles.muted} aria-live="polite">
              {deleted ? 'Страница «Отзывы» удалена (понарошку).' : ''}
            </p>
          </div>
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
