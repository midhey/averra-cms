import { SiteFooter, SiteHeader, siteFooterView, siteHeaderView } from '@averra/blocks'
import {
  demoPage,
  emptyFooterContacts,
  type Footer,
  type FooterContacts,
  HEADER_LABEL_MAX,
  Header,
  HeaderLayout,
  type HeaderTargetPage,
  headerLayoutHints,
  headerLayoutTitles,
  headerLinkIssues,
  MAIN_PAGE_SLUG,
  PageContent,
  sameHeader,
} from '@averra/schema'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { type FormEvent, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { type Device, DeviceSwitch, initialDevice, Preview } from '../editor/Preview'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { FooterFields } from '../footer/FooterFields'
import { footerHiddenOnText, footerStatus } from '../footer/footer-format'
import { useFooterEditor } from '../footer/use-footer-editor'
import { type FieldErrors, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { useFormErrors } from '../forms/use-form-errors'
import { HeaderLayoutSketch, LinkSelect, MenuEditor } from '../header/HeaderParts'
import { headerStatus, hiddenOnText, newHeaderButton, overlayHint } from '../header/header-format'
import { MediaPickField } from '../media/MediaPickField'
import { mediaMapOf } from '../media/media-format'
import { pagePath } from '../pages-format'
import { canEditHeader, canEditSeo } from '../permissions'
import { footerQuery, headerQuery, mediaQuery, pageQuery, queryKeys, siteQuery } from '../queries'
import { UnsavedChangesGuard, useReportUnsaved } from '../seo/unsaved'
import { Button } from '../ui/Button'
import { Checkbox, TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { FormActions, formClassName, Screen, Section } from '../ui/Screen'
import { SegmentedControl } from '../ui/SegmentedControl'
import { StatusPill } from '../ui/StatusPill'
import { Tabs } from '../ui/Tabs'
import { usePageTitle } from '../ui/use-page-title'
import { useSiteId } from '../use-site'
import styles from './HeaderScreen.module.scss'

type Notice = { kind: 'done' | 'error'; text: string }
type Tab = 'header' | 'menu' | 'footer'

const tabs = [
  { id: 'header', label: 'Шапка' },
  { id: 'menu', label: 'Меню' },
  { id: 'footer', label: 'Подвал' },
] as const

/** Поле формы по пути ошибки: у цели пункта одно поле выбора на страницу и блок */
const fieldName = (path: string) => path.replace(/\.(page|block)$/, '.target')

/**
 * «Шапка и подвал» по концепту: вкладки «Шапка» (раскладка, поведение, кнопка, логотип), «Меню»
 * (пункты с перетаскиванием) и «Подвал» (вид, фон, колонки, форма); справа — предпросмотр на
 * главной теми же компонентами, что собирают сайт. «Сохранить» — черновик, «Опубликовать» — на
 * сайт (пересборка). У шапки с меню и у подвала публикации свои: кнопки внизу — той вкладки,
 * что открыта
 */
export function HeaderScreen() {
  const siteId = useSiteId()
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { data: view } = useSuspenseQuery(headerQuery(siteId))
  const { data: footer } = useSuspenseQuery(footerQuery(siteId))
  usePageTitle('Шапка и подвал', site.name)
  return (
    <Screen>
      <PageHeader
        eyebrow={site.name}
        title="Шапка и подвал"
        meta="Одни на весь сайт; на отдельной странице шапку и подвал можно скрыть"
      />
      <UnsavedChangesGuard>
        <HeaderEditor
          siteId={siteId}
          siteName={site.name}
          theme={site.theme}
          draft={view.draft}
          onSite={view.published !== null}
          unpublished={view.unpublished}
          pages={view.targets}
          contacts={view.contacts}
          readOnly={!canEditHeader(site.access)}
          seoLinks={canEditSeo(site.access)}
          footer={footer}
        />
      </UnsavedChangesGuard>
    </Screen>
  )
}

type EditorProps = {
  siteId: string
  siteName: string
  theme: Parameters<typeof Preview>[0]['theme']
  draft: Header
  onSite: boolean
  unpublished: boolean
  pages: HeaderTargetPage[]
  /**
   * Телефон и адрес из «SEO → Организация». null — главная не опубликована: на сайте их ещё нет
   * (как и разметки организации), поэтому API их не отдаёт
   */
  contacts: { phone: string; address: string } | null
  readOnly: boolean
  /** Экраны «SEO» («Организация», «Cookie и согласие») — владельцу: ссылки на них только ему */
  seoLinks: boolean
  /** Подвал с сервера: черновик, что на сайте, политика, «Настройки cookie», контакты */
  footer: {
    draft: Footer
    published: Footer | null
    unpublished: boolean
    policy: { slug: string; published: boolean }
    cookieSettings: boolean
    contacts: FooterContacts | null
  }
}

function HeaderEditor(props: EditorProps) {
  const { siteId, draft, onSite, unpublished, pages, contacts, readOnly } = props
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [form, setForm] = useState<Header>(draft)
  const [tab, setTab] = useState<Tab>('header')
  const [notice, setNotice] = useState<Notice>()
  const footer = useFooterEditor({
    siteId,
    draft: props.footer.draft,
    onNotice: setNotice,
    onFieldError: (name) => {
      setTab('footer')
      focusLater(name)
    },
  })
  // Черновик сменился на сервере (сохранили в другой вкладке): форма без правок берёт новый,
  // правки человека не трогаем — как на экране «Тема»
  const [base, setBase] = useState(draft)
  if (!sameHeader(base, draft)) {
    setBase(draft)
    const current = Header.safeParse(form)
    if (current.success && sameHeader(current.data, base)) setForm(draft)
  }
  const parsed = Header.safeParse(form)
  const errors = useFormErrors(zodFieldErrors(parsed.error))
  const unsaved = !parsed.success || !sameHeader(parsed.data, draft)
  useReportUnsaved(unsaved)
  // Пока подпись недописана, предпросмотр показывает последнюю целую шапку
  const shown = useRef(draft)
  if (parsed.success) shown.current = parsed.data
  // Что помешает публикации: пункт ведёт на неопубликованную страницу или пропавший блок
  const publishIssues = headerLinkIssues(shown.current, pages, 'published')
  const warningAt = (prefix: string) =>
    publishIssues.find((issue) => issue.path.startsWith(`${prefix}.`))?.message
  const menuWarnings = new Map(
    form.menu.flatMap((_, index) => {
      const warning = warningAt(`menu.${index}`)
      return warning ? [[index, warning] as const] : []
    }),
  )

  const change = (next: Header, field?: string) => {
    setForm(next)
    setNotice(undefined)
    if (field) errors.clearServerError(field)
  }

  const save = useMutation({
    mutationFn: async (body: Header) => {
      const res = await api.sites[':siteId'].header.$put({ param: { siteId }, json: body })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })
  const publish = useMutation({
    mutationFn: async () => {
      const res = await api.sites[':siteId'].header.publish.$post({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })
  const takeDown = useMutation({
    mutationFn: async () => {
      const res = await api.sites[':siteId'].header.$delete({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })
  const pending = save.isPending || publish.isPending || takeDown.isPending

  /** Фокус на поле по имени — после того, как его вкладка отрисуется */
  function focusLater(name: string) {
    requestAnimationFrame(() => {
      const field = formRef.current?.elements.namedItem(name)
      // Группа радиокнопок (вид подвала) — RadioNodeList: фокус на выбранную
      const target =
        field instanceof RadioNodeList
          ? ([...field].find((node) => node instanceof HTMLInputElement && node.checked) ??
            field[0])
          : field
      if (target instanceof HTMLElement) target.focus()
    })
  }

  /** Ошибка у поля: открыть его вкладку и перевести фокус на него */
  function focusError(fieldErrors: FieldErrors) {
    const path = Object.keys(fieldErrors)[0]
    if (!path) return
    setTab(path.startsWith('menu') ? 'menu' : 'header')
    focusLater(fieldName(path))
  }

  const showError = (error: unknown, action: string) => {
    if (error instanceof ApiRequestError && error.issues.length > 0) {
      const fieldErrors = Object.fromEntries(
        Object.entries(issueFieldErrors(error.issues)).map(([path, message]) => [
          path.replace(/\.(page|block)$/, '.page'),
          message,
        ]),
      )
      errors.showServerErrors(fieldErrors)
      focusError(fieldErrors)
    }
    setNotice({ kind: 'error', text: `${action}: ${messageOf(error)}` })
  }

  async function saveDraft() {
    if (!parsed.success) {
      errors.attempt()
      setNotice({ kind: 'error', text: 'Шапку не сохранить: поправьте отмеченные поля' })
      focusError(zodFieldErrors(parsed.error))
      return false
    }
    try {
      const saved = await save.mutateAsync(parsed.data)
      queryClient.setQueryData(queryKeys.header(siteId), (current) =>
        current ? { ...current, ...saved } : current,
      )
      setForm(saved.draft)
      errors.reset()
      return true
    } catch (error) {
      showError(error, 'Не удалось сохранить')
      return false
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Enter в поле вкладки «Подвал» сохраняет подвал: у него своя кнопка и своя публикация
    if (tab === 'footer') {
      if (!footer.pending) await footer.save()
      return
    }
    setNotice(undefined)
    if (await saveDraft()) {
      setNotice({ kind: 'done', text: 'Шапка сохранена. На сайте она появится после публикации' })
    }
  }

  /** Убрать шапку с сайта: настройки остаются черновиком, их можно опубликовать снова */
  async function onTakeDown() {
    if (!window.confirm('Убрать шапку со всех страниц сайта? Настройки останутся черновиком.')) {
      return
    }
    setNotice(undefined)
    try {
      const state = await takeDown.mutateAsync()
      queryClient.setQueryData(queryKeys.header(siteId), (current) =>
        current ? { ...current, ...state } : current,
      )
      setNotice({ kind: 'done', text: 'Шапку убрали с сайта. Сайт пересобирается' })
      await queryClient.invalidateQueries({ queryKey: queryKeys.build(siteId) })
    } catch (error) {
      showError(error, 'Не удалось убрать шапку')
    }
  }

  async function onPublish() {
    setNotice(undefined)
    if (unsaved && !(await saveDraft())) return
    try {
      const published = await publish.mutateAsync()
      queryClient.setQueryData(queryKeys.header(siteId), (current) =>
        current ? { ...current, ...published } : current,
      )
      setForm(published.draft)
      setNotice({
        kind: 'done',
        text: 'Шапка опубликована. Сайт пересобирается — через минуту она будет на всех страницах',
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.build(siteId) })
    } catch (error) {
      showError(error, 'Не удалось опубликовать')
    }
  }

  const status = headerStatus({ unsaved, unpublished, onSite })
  const footerState = footerStatus({
    unsaved: footer.unsaved,
    unpublished: props.footer.unpublished,
    onSite: props.footer.published !== null,
  })
  const errorOf = (path: string) => errors.errors[path]
  const hidden = hiddenOnText(pages)

  return (
    <div className={styles.layout}>
      <form
        ref={formRef}
        aria-label="Шапка и подвал"
        className={`${formClassName} ${styles.settings}`}
        onSubmit={onSubmit}
        noValidate
      >
        {readOnly && (
          <InlineAlert tone="info">
            Шапку, меню и подвал меняют владелец и редактор сайта: их публикация пересобирает весь
            сайт.
          </InlineAlert>
        )}
        <Tabs
          label="Что настраиваем"
          items={tabs}
          value={tab}
          onChange={setTab}
          panelFocusable={false}
        >
          {tab === 'header' && (
            <div className={styles.panel}>
              <Section title="Раскладка" card>
                <SegmentedControl
                  legend="Раскладка"
                  hideLegend
                  appearance="cards"
                  columns={2}
                  name="layout"
                  disabled={readOnly}
                  options={HeaderLayout.options.map((layout) => ({
                    value: layout,
                    label: headerLayoutTitles[layout],
                    thumbnail: <HeaderLayoutSketch layout={layout} />,
                  }))}
                  value={form.layout}
                  onChange={(layout) => change({ ...form, layout })}
                />
                <p className={styles.note}>{headerLayoutHints[form.layout]}.</p>
              </Section>

              <Section title="Поведение" card>
                <div className={styles.toggles}>
                  <Checkbox
                    label="Липкая шапка"
                    hint="Остаётся сверху, пока листают страницу"
                    checked={form.sticky}
                    disabled={readOnly}
                    onChange={(event) =>
                      change({
                        ...form,
                        sticky: event.target.checked,
                        // Собраться может только шапка, которая остаётся сверху
                        condense: event.target.checked && form.condense,
                      })
                    }
                  />
                  <Checkbox
                    label="Собирается при прокрутке"
                    name="condense"
                    hint={
                      form.sticky
                        ? 'Наверху — полная, ниже — компактная строка с телефоном. Без JavaScript шапка просто остаётся полной'
                        : 'Только у липкой шапки: включите «Липкая шапка»'
                    }
                    error={errorOf('condense')}
                    checked={form.condense}
                    disabled={readOnly || !form.sticky}
                    onChange={(event) =>
                      change({ ...form, condense: event.target.checked }, 'condense')
                    }
                  />
                  <Checkbox
                    label="Прозрачная на первом экране"
                    hint={overlayHint(pages)}
                    checked={form.overlay}
                    disabled={readOnly}
                    onChange={(event) => change({ ...form, overlay: event.target.checked })}
                  />
                  <Checkbox
                    label="Телефон в шапке"
                    hint={
                      contacts === null
                        ? 'Телефон из «SEO → Организация» появится в шапке, когда главная страница будет опубликована'
                        : contacts.phone
                          ? `${contacts.phone} — из «SEO → Организация», ссылкой для звонка`
                          : 'В «SEO → Организация» телефона нет — в шапке его не будет, пока его не впишут там'
                    }
                    checked={form.phone}
                    disabled={readOnly}
                    onChange={(event) => change({ ...form, phone: event.target.checked })}
                  />
                </div>
              </Section>

              <Section title="Кнопка" card>
                <Checkbox
                  label="Кнопка в шапке"
                  hint="Например «Рассчитать» — ведёт к форме заявки"
                  checked={form.button !== null}
                  disabled={readOnly}
                  onChange={(event) =>
                    change(
                      { ...form, button: event.target.checked ? newHeaderButton(pages) : null },
                      'button.label',
                    )
                  }
                />
                {form.button && (
                  <div className={styles.buttonFields}>
                    <TextInput
                      label="Текст кнопки"
                      name="button.label"
                      value={form.button.label}
                      maxChars={HEADER_LABEL_MAX}
                      error={errorOf('button.label')}
                      disabled={readOnly}
                      onChange={(event) => {
                        if (form.button) {
                          change(
                            { ...form, button: { ...form.button, label: event.target.value } },
                            'button.label',
                          )
                        }
                      }}
                    />
                    <LinkSelect
                      label="Куда ведёт"
                      name="button.target"
                      link={form.button}
                      pages={pages}
                      error={errorOf('button.page')}
                      hint={warningAt('button')}
                      disabled={readOnly}
                      onChange={(link) => {
                        if (form.button)
                          change(
                            { ...form, button: { label: form.button.label, ...link } },
                            'button.page',
                          )
                      }}
                    />
                  </div>
                )}
              </Section>

              <Section title="Логотип" card>
                <MediaPickField
                  siteId={siteId}
                  label="Логотип"
                  name="logo"
                  allowSvg
                  hint={`Картинка или SVG из медиатеки. Без логотипа в шапке — название сайта «${props.siteName}»`}
                  value={form.logo}
                  error={errorOf('logo')}
                  disabled={readOnly}
                  onChange={(logo) => change({ ...form, logo }, 'logo')}
                />
              </Section>

              <InlineAlert tone="info">
                {hidden ? `${hidden}. ` : ''}Скрыть шапку на отдельной странице (например, промо) —
                в редакторе страницы: «SEO» → «Шапка сайта».
              </InlineAlert>
            </div>
          )}

          {tab === 'menu' && (
            <div className={styles.panel}>
              <Section
                title="Меню"
                description="Пункты — страницы сайта или блоки на них. Порядок — перетаскиванием за ручку или стрелками"
                card
              >
                {form.layout === 'minimal' && (
                  <InlineAlert tone="info">
                    В раскладке «Минимум» меню не показывается: в ней только логотип и кнопка.
                  </InlineAlert>
                )}
                <MenuEditor
                  items={form.menu}
                  pages={pages}
                  errors={Object.fromEntries(
                    Object.entries(errors.errors).filter(([path]) => path.startsWith('menu.')),
                  )}
                  warnings={menuWarnings}
                  disabled={readOnly}
                  onChange={(menu) => {
                    change({ ...form, menu: [...menu] })
                    // Номера пунктов сдвинулись: прежние ошибки сервера встали бы не к тем
                    errors.showServerErrors({})
                  }}
                />
              </Section>
            </div>
          )}

          {tab === 'footer' && (
            <FooterFields
              editor={footer}
              contacts={props.footer.contacts}
              policy={props.footer.policy}
              menuSize={shown.current.menu.length}
              hiddenOn={footerHiddenOnText(
                pages
                  .filter((page) => page.published)
                  .map((page) => ({ title: page.title, hidden: page.hideFooter })),
              )}
              seoLinks={props.seoLinks}
              readOnly={readOnly}
            />
          )}
        </Tabs>

        {/* Кнопки и итог прилипают к низу колонки, как на экране «Тема» */}
        <div className={styles.actions}>
          {notice?.kind === 'error' && <InlineAlert tone="danger">{notice.text}</InlineAlert>}
          {notice?.kind === 'done' && (
            <InlineAlert tone="success" live>
              {notice.text}
            </InlineAlert>
          )}
          {!readOnly && tab === 'footer' && (
            <FormActions>
              <Button
                loading={footer.saving}
                aria-disabled={footer.pending ? true : undefined}
                onClick={() => {
                  if (!footer.pending) void footer.save()
                }}
              >
                Сохранить подвал
              </Button>
              <Button
                variant="primary"
                loading={footer.publishing}
                aria-disabled={
                  footer.pending || (!footer.unsaved && !props.footer.unpublished)
                    ? true
                    : undefined
                }
                onClick={() => {
                  if (!footer.pending && (footer.unsaved || props.footer.unpublished)) {
                    void footer.publish()
                  }
                }}
              >
                Опубликовать подвал
              </Button>
              <StatusPill tone={footerState.tone} appearance="dot">
                {footerState.text}
              </StatusPill>
              {props.footer.published !== null && (
                <Button
                  variant="ghost"
                  loading={footer.takingDown}
                  aria-disabled={footer.pending ? true : undefined}
                  onClick={() => {
                    if (!footer.pending) void footer.takeDown()
                  }}
                >
                  Убрать с сайта
                </Button>
              )}
            </FormActions>
          )}
          {!readOnly && tab !== 'footer' && (
            <FormActions>
              <Button type="submit" loading={save.isPending && !publish.isPending}>
                Сохранить
              </Button>
              <Button
                variant="primary"
                loading={publish.isPending}
                aria-disabled={pending || (!unsaved && !unpublished) ? true : undefined}
                onClick={() => {
                  if (!pending && (unsaved || unpublished)) void onPublish()
                }}
              >
                Опубликовать
              </Button>
              <StatusPill tone={status.tone} appearance="dot">
                {status.text}
              </StatusPill>
              {onSite && (
                <Button
                  variant="ghost"
                  loading={takeDown.isPending}
                  aria-disabled={pending ? true : undefined}
                  onClick={() => {
                    if (!pending) void onTakeDown()
                  }}
                >
                  Убрать с сайта
                </Button>
              )}
            </FormActions>
          )}
        </div>
      </form>
      <HeaderPreview
        siteId={siteId}
        siteName={props.siteName}
        theme={props.theme}
        header={shown.current}
        pages={pages}
        contacts={contacts ?? { phone: '', address: '' }}
        footer={{
          footer: footer.shown,
          contacts: props.footer.contacts ?? emptyFooterContacts,
          // Политика — ссылкой, только если опубликована: как на сайте
          policyHref: props.footer.policy.published ? pagePath(props.footer.policy.slug) : null,
          cookieSettings: props.footer.cookieSettings,
        }}
        focus={tab === 'footer' ? 'footer' : 'header'}
      />
    </div>
  )
}

type PreviewProps = {
  siteId: string
  siteName: string
  theme: EditorProps['theme']
  header: Header
  pages: readonly HeaderTargetPage[]
  contacts: { phone: string; address: string }
  footer: {
    footer: Footer
    contacts: FooterContacts
    policyHref: string | null
    cookieSettings: boolean
  }
  /** Что сейчас настраивают: на вкладке «Подвал» предпросмотр прокручен к низу страницы */
  focus: 'header' | 'footer'
}

/**
 * Предпросмотр шапки и подвала на главной — с темой сайта и теми же компонентами, что на сайте.
 * Пустая главная — пример лендинга. Ссылки меню ведут и на неопубликованное: так видно черновик
 * целиком. Подвал — черновик вкладки «Подвал», разделы в нём — пункты меню из черновика шапки
 */
function HeaderPreview(props: PreviewProps) {
  const { siteId, siteName, theme, header, pages, contacts, focus } = props
  const [device, setDevice] = useState<Device>(initialDevice)
  const main = useQuery(pageQuery(siteId, MAIN_PAGE_SLUG))
  const library = useQuery(mediaQuery(siteId))
  const media = useMemo(() => mediaMapOf(library.data?.items ?? []), [library.data])
  const draft = main.data?.draft
  const empty = draft === undefined || draft.blocks.length === 0
  const content = useMemo(
    // На главной шапка и подвал могут быть скрыты, но здесь смотрят именно их
    () => ({
      ...(empty ? PageContent.parse(demoPage) : draft),
      hideHeader: false,
      hideFooter: false,
    }),
    [draft, empty],
  )
  const linkable = pages.map((page) => ({
    slug: page.slug,
    blockIds: page.blocks.map((block) => block.id),
  }))
  const page = { slug: MAIN_PAGE_SLUG, content }
  const view = siteHeaderView({ header, siteName, page, pages: linkable, contacts })
  const footerView = siteFooterView({
    footer: props.footer.footer,
    siteName,
    page,
    header,
    pages: linkable,
    contacts: props.footer.contacts,
    legal: { policyHref: props.footer.policyHref, cookieSettings: props.footer.cookieSettings },
    year: new Date().getFullYear(),
  })
  const subject = focus === 'footer' ? 'подвал' : 'шапка'
  // На вкладке «Подвал» предпросмотр прокручивается вниз при смене подвала или устройства,
  // а не на каждую перерисовку
  const scrollKey = focus === 'footer' ? JSON.stringify([device, footerView]) : undefined
  return (
    <section
      aria-label={focus === 'footer' ? 'Предпросмотр подвала' : 'Предпросмотр шапки'}
      className={styles.preview}
    >
      <div className={styles.previewBar}>
        <p className={styles.note}>
          {empty
            ? `Главная пока пустая — ${subject} показан${focus === 'footer' ? '' : 'а'} с примером лендинга. `
            : 'Предпросмотр на главной — с настоящей темой сайта. '}
          На сайт {subject} попадёт после публикации.
        </p>
        <DeviceSwitch value={device} onChange={setDevice} />
      </div>
      <div className={styles.frame}>
        <Preview
          title={focus === 'footer' ? 'Предпросмотр подвала' : 'Предпросмотр шапки'}
          content={content}
          theme={theme}
          media={media}
          device={device}
          selectedId={null}
          before={view && <SiteHeader view={view} media={media} />}
          extra={footerView && <SiteFooter view={footerView} preview />}
          scrollToEnd={scrollKey}
        />
      </div>
    </section>
  )
}
