import {
  CustomBlockDraft,
  canonicalPath,
  demoPage,
  emptyFooterContacts,
  type Footer,
  type FooterContacts,
  HEADER_LABEL_MAX,
  Header,
  HeaderBrand,
  HeaderButtonHover,
  HeaderButtonShape,
  HeaderLayout,
  HeaderLinkHover,
  type HeaderLook,
  HeaderMobileAlign,
  HeaderMobileButton,
  HeaderMobileMenu,
  type HeaderTargetPage,
  headerBrandTitles,
  headerButtonHoverTitles,
  headerButtonShapeTitles,
  headerLayoutHints,
  headerLayoutTitles,
  headerLinkHoverTitles,
  headerLinkIssues,
  headerMobileAlignTitles,
  headerMobileButtonTitles,
  headerMobileMenuTitles,
  LOGO_MARK_MAX,
  LOGO_TEXT_MAX,
  MAIN_PAGE_SLUG,
  PageContent,
  sameHeader,
  siteLinkHref,
} from '@averra/schema'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { type FormEvent, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useCustomBlockMap } from '../custom-blocks/use-custom-block-map'
import { type Device, DeviceSwitch, initialDevice, Preview } from '../editor/Preview'
import { SandboxPreview } from '../editor/SandboxPreview'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { FooterFields } from '../footer/FooterFields'
import { footerHiddenOnText, footerStatus } from '../footer/footer-format'
import { useFooterEditor } from '../footer/use-footer-editor'
import { type FieldErrors, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import type { FieldProps, Widgets } from '../forms/SchemaForm'
import { useFormErrors } from '../forms/use-form-errors'
import { CustomPlaceFields } from '../header/CustomPlaceFields'
import { HeaderLayoutSketch, LinkTarget, MenuEditor } from '../header/HeaderParts'
import {
  headerStatus,
  hiddenOnText,
  newHeaderButton,
  overlayHint,
  withTarget,
} from '../header/header-format'
import { adoptHeaderLook, isLookConflict, LOOK_CHANGED_NOTICE } from '../header/look-conflict'
import { siteChrome } from '../header/site-chrome'
import { ImageField } from '../media/ImageField'
import { MediaPickField } from '../media/MediaPickField'
import { mediaMapOf } from '../media/media-format'
import { canDefineBlocks, canEditHeader, canEditHeaderLook, canEditSeo } from '../permissions'
import {
  customBlocksQuery,
  footerQuery,
  headerQuery,
  mediaQuery,
  pageQuery,
  queryKeys,
  siteQuery,
} from '../queries'
import { UnsavedChangesGuard, useReportUnsaved } from '../seo/unsaved'
import { Button } from '../ui/Button'
import { useConfirm } from '../ui/Confirm'
import { Checkbox, TextArea, TextInput } from '../ui/Field'
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
          publishedMenu={view.published?.menu ?? null}
          unpublished={view.unpublished}
          pages={view.targets}
          contacts={view.contacts}
          readOnly={!canEditHeader(site.access)}
          lookReadOnly={!canEditHeaderLook(site.access)}
          seoLinks={canEditSeo(site.access)}
          canDefine={canDefineBlocks(site.access)}
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
  /** Меню опубликованной шапки (null — её нет на сайте): из него разделы подвала на сайте */
  publishedMenu: Header['menu'] | null
  unpublished: boolean
  pages: HeaderTargetPage[]
  /**
   * Телефон и адрес из «SEO → Организация». null — главная не опубликована: на сайте их ещё нет
   * (как и разметки организации), поэтому API их не отдаёт
   */
  contacts: { phone: string; address: string } | null
  readOnly: boolean
  /**
   * Вид шапки и подвала (раскладка, поведение, раздел «Вид», фон подвала) меняет только владелец
   * (header.look): администратор сайта видит его только для чтения
   */
  lookReadOnly: boolean
  /** Экраны «SEO» («Организация», «Cookie и согласие») — владельцу: ссылки на них только ему */
  seoLinks: boolean
  /** Владелец: делает свои блоки, в том числе свои виды шапки и подвала */
  canDefine: boolean
  /** Подвал с сервера: черновик, что на сайте, политика, «Настройки cookie», контакты */
  footer: {
    draft: Footer
    published: Footer | null
    unpublished: boolean
    policy: { slug: string; published: boolean }
    consent: { slug: string; published: boolean }
    cookieSettings: boolean
    contacts: FooterContacts | null
  }
}

/** Меню по смыслу, без порядка ключей: пункты из формы и с сервера сравниваются честно */
const menuKey = (menu: Header['menu']) =>
  JSON.stringify(menu.map((item) => [item.label, item.page, item.block ?? '']))

function HeaderEditor(props: EditorProps) {
  const { siteId, draft, onSite, unpublished, pages, contacts, readOnly } = props
  // Вид — только владельцу; у того, кто и тексты не меняет, вид тем более только для чтения
  const lookReadOnly = readOnly || props.lookReadOnly
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [form, setForm] = useState<Header>(draft)
  const [tab, setTab] = useState<Tab>('header')
  const [notice, setNotice] = useState<Notice>()
  // Свои виды шапки и подвала — свои блоки с местом. Владелец видит и черновики (выбрать можно до
  // публикации определения, опубликовать шапку — нет), остальные — опубликованные
  const custom = useQuery(customBlocksQuery(siteId))
  const places = useMemo(() => placeDefinitions(custom.data?.blocks ?? []), [custom.data])
  const widgets = useMemo<Widgets>(
    () => ({ image: (field: FieldProps) => <ImageField {...field} siteId={siteId} /> }),
    [siteId],
  )
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

  const setLook = (look: Partial<HeaderLook>) =>
    change({ ...form, look: { ...form.look, ...look } })
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
  const confirm = useConfirm()
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
      if (isLookConflict(error)) {
        // Владелец поменял вид, пока экран был открыт: берём новый вид, тексты остаются
        try {
          const fresh = await queryClient.fetchQuery({ ...headerQuery(siteId), staleTime: 0 })
          setForm((current) => adoptHeaderLook(current, fresh.draft))
          setNotice({ kind: 'error', text: LOOK_CHANGED_NOTICE })
        } catch (reload) {
          showError(reload, 'Не удалось обновить экран')
        }
        return false
      }
      showError(error, 'Не удалось сохранить')
      return false
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Enter в поле вкладки «Подвал» сохраняет подвал: у него своя кнопка и своя публикация
    if (tab === 'footer') {
      if (!footer.pending && footer.unsaved) await footer.save()
      return
    }
    // Без правок сохранять нечего: кнопка выключена, Enter в поле тоже ничего не делает
    if (!unsaved) return
    setNotice(undefined)
    if (await saveDraft()) {
      setNotice({ kind: 'done', text: 'Шапка сохранена. На сайте она появится после публикации' })
    }
  }

  /** Убрать шапку с сайта: настройки остаются черновиком, их можно опубликовать снова */
  async function onTakeDown() {
    const yes = await confirm({
      title: 'Убрать шапку со всех страниц сайта?',
      description: 'Настройки останутся черновиком.',
      confirmLabel: 'Убрать шапку',
      cancelLabel: 'Оставить',
    })
    if (!yes) return
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
          <InlineAlert tone="info" title="Только просмотр">
            Шапку, меню и подвал меняют владелец и администратор сайта: их публикация пересобирает
            весь сайт.
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
              <CustomPlaceFields
                place="header"
                value={form.custom}
                definitions={places.header}
                errors={errors.errors}
                widgets={widgets}
                readOnly={readOnly}
                lookReadOnly={lookReadOnly}
                canDefine={props.canDefine}
                onChange={(next) => change({ ...form, custom: next }, 'custom.key')}
              />
              {!form.custom && (
                <Section title="Раскладка" card>
                  <SegmentedControl
                    legend="Раскладка"
                    hideLegend
                    appearance="cards"
                    columns={2}
                    name="layout"
                    disabled={lookReadOnly}
                    options={HeaderLayout.options.map((layout) => ({
                      value: layout,
                      label: headerLayoutTitles[layout],
                      thumbnail: <HeaderLayoutSketch layout={layout} />,
                    }))}
                    value={form.layout}
                    onChange={(layout) => change({ ...form, layout })}
                  />
                  <p className={styles.note}>{headerLayoutHints[form.layout]}.</p>
                  {lookReadOnly && !readOnly && (
                    <InlineAlert tone="info">
                      Раскладку, поведение и вид шапки и подвала меняет владелец установки: это
                      фирменный стиль сайта. Тексты, ссылки, кнопку, логотип и меню вы меняете сами.
                    </InlineAlert>
                  )}
                </Section>
              )}

              <Section title="Поведение" card>
                <div className={styles.toggles}>
                  <Checkbox
                    label="Липкая шапка"
                    hint="Остаётся сверху, пока листают страницу"
                    checked={form.sticky}
                    disabled={lookReadOnly}
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
                    disabled={lookReadOnly || !form.sticky}
                    onChange={(event) =>
                      change({ ...form, condense: event.target.checked }, 'condense')
                    }
                  />
                  {!form.custom && (
                    <Checkbox
                      label="Прозрачная на первом экране"
                      hint={overlayHint(pages)}
                      checked={form.overlay}
                      disabled={lookReadOnly}
                      onChange={(event) => change({ ...form, overlay: event.target.checked })}
                    />
                  )}
                  {!form.custom && (
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
                  )}
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
                    <TextInput
                      label="Текст на телефоне"
                      name="button.mobileLabel"
                      value={form.button.mobileLabel}
                      maxChars={HEADER_LABEL_MAX}
                      placeholder={form.button.label}
                      hint="Короче основного: на узком экране места меньше. Пусто — как основной"
                      error={errorOf('button.mobileLabel')}
                      disabled={readOnly}
                      onChange={(event) => {
                        if (form.button) {
                          change(
                            {
                              ...form,
                              button: { ...form.button, mobileLabel: event.target.value },
                            },
                            'button.mobileLabel',
                          )
                        }
                      }}
                    />
                    <LinkTarget
                      label="Куда ведёт"
                      path="button"
                      link={form.button}
                      pages={pages}
                      errors={errors.errors}
                      hint={warningAt('button')}
                      disabled={readOnly}
                      onChange={(link) => {
                        if (form.button) {
                          errors.clearServerError('button.url')
                          change({ ...form, button: withTarget(form.button, link) }, 'button.page')
                        }
                      }}
                    />
                  </div>
                )}
              </Section>

              <Section title="Логотип" card>
                <SegmentedControl
                  legend="Логотип в шапке"
                  name="brand"
                  disabled={readOnly}
                  options={HeaderBrand.options.map((brand) => ({
                    value: brand,
                    label: headerBrandTitles[brand],
                  }))}
                  value={form.brand}
                  onChange={(brand) => change({ ...form, brand })}
                />
                {form.brand !== 'text' && (
                  <MediaPickField
                    siteId={siteId}
                    label="Картинка логотипа"
                    name="logo"
                    allowSvg
                    hint={
                      form.brand === 'image'
                        ? `Картинка или SVG из медиатеки. Без неё в шапке — название сайта «${props.siteName}»`
                        : 'Картинка или SVG из медиатеки, подпись — справа от неё'
                    }
                    value={form.logo}
                    error={errorOf('logo')}
                    disabled={readOnly}
                    onChange={(logo) => change({ ...form, logo }, 'logo')}
                  />
                )}
                {form.brand === 'text' && form.logo !== null && (
                  // В виде «Текст» картинка не хранится: иначе её нельзя было бы удалить из медиатеки
                  <p className={styles.note}>
                    Картинка логотипа уберётся из шапки при сохранении. Вернуть — выбрать «Картинку»
                    до сохранения.
                  </p>
                )}
                {form.brand === 'text' && (
                  <TextInput
                    label="Знак"
                    name="logoMark"
                    value={form.logoMark}
                    maxChars={LOGO_MARK_MAX}
                    hint="Одна-четыре буквы акцентным шрифтом темы перед подписью, например «Ve». Пусто — без знака"
                    error={errorOf('logoMark')}
                    disabled={readOnly}
                    onChange={(event) =>
                      change({ ...form, logoMark: event.target.value }, 'logoMark')
                    }
                  />
                )}
                {form.brand !== 'image' && (
                  <TextArea
                    label="Подпись"
                    name="logoText"
                    rows={2}
                    value={form.logoText}
                    maxChars={LOGO_TEXT_MAX}
                    placeholder={props.siteName}
                    hint={`До двух строк, перенос — Enter. Пусто — название сайта «${props.siteName}»`}
                    error={errorOf('logoText')}
                    disabled={readOnly}
                    onChange={(event) =>
                      change({ ...form, logoText: event.target.value }, 'logoText')
                    }
                  />
                )}
              </Section>

              {!form.custom && (
                <Section
                  title="Вид"
                  description="Только роли темы: контраст уже проверен темой"
                  card
                >
                  <div className={styles.toggles}>
                    <Checkbox
                      label="Линия под шапкой"
                      hint="Без линии шапка сливается с фоном страницы"
                      checked={form.look.divider}
                      disabled={lookReadOnly}
                      onChange={(event) => setLook({ divider: event.target.checked })}
                    />
                    <SegmentedControl
                      legend="Форма кнопки"
                      wrap
                      disabled={lookReadOnly}
                      options={HeaderButtonShape.options.map((value) => ({
                        value,
                        label: headerButtonShapeTitles[value],
                      }))}
                      value={form.look.buttonShape}
                      onChange={(buttonShape) => setLook({ buttonShape })}
                    />
                    <SegmentedControl
                      legend="Кнопка при наведении"
                      wrap
                      disabled={lookReadOnly}
                      options={HeaderButtonHover.options.map((value) => ({
                        value,
                        label: headerButtonHoverTitles[value],
                      }))}
                      value={form.look.buttonHover}
                      onChange={(buttonHover) => setLook({ buttonHover })}
                    />
                    <SegmentedControl
                      legend="Пункты меню при наведении"
                      wrap
                      disabled={lookReadOnly}
                      options={HeaderLinkHover.options.map((value) => ({
                        value,
                        label: headerLinkHoverTitles[value],
                      }))}
                      value={form.look.linkHover}
                      onChange={(linkHover) => setLook({ linkHover })}
                    />
                  </div>
                </Section>
              )}

              {!form.custom && (
                <Section
                  title="На телефоне"
                  description="Меню на телефоне открывается и без JavaScript"
                  card
                >
                  <div className={styles.toggles}>
                    <SegmentedControl
                      legend="Кнопка на телефоне"
                      wrap
                      disabled={lookReadOnly}
                      options={HeaderMobileButton.options.map((value) => ({
                        value,
                        label: headerMobileButtonTitles[value],
                      }))}
                      value={form.look.mobileButton}
                      onChange={(mobileButton) => setLook({ mobileButton })}
                    />
                    <p className={styles.note}>
                      {form.look.mobileButton === 'row'
                        ? 'Кнопка видна рядом с «Меню», не раскрывая его. Короткий «Текст на телефоне» держит строку на узком экране.'
                        : 'Кнопка — внизу раскрытого меню. Без меню она всегда в строке.'}
                    </p>
                    <SegmentedControl
                      legend="Меню на телефоне"
                      wrap
                      disabled={lookReadOnly}
                      options={HeaderMobileMenu.options.map((value) => ({
                        value,
                        label: headerMobileMenuTitles[value],
                      }))}
                      value={form.look.mobileMenu}
                      onChange={(mobileMenu) => setLook({ mobileMenu })}
                    />
                    <SegmentedControl
                      legend="Пункты меню на телефоне"
                      wrap
                      disabled={lookReadOnly}
                      options={HeaderMobileAlign.options.map((value) => ({
                        value,
                        label: headerMobileAlignTitles[value],
                      }))}
                      value={form.look.mobileAlign}
                      onChange={(mobileAlign) => setLook({ mobileAlign })}
                    />
                  </div>
                </Section>
              )}

              <InlineAlert tone="info">
                {hidden ? `${hidden}. ` : ''}Скрыть шапку на отдельной странице (например, промо)
                или сделать её короткой — логотип и «← На главную» для «Спасибо», документов и своей
                404 — в редакторе страницы: «SEO» → «Шапка сайта».
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
              consent={props.footer.consent}
              menuOnSite={props.publishedMenu?.length ?? null}
              menuEdited={menuKey(shown.current.menu) !== menuKey(props.publishedMenu ?? [])}
              hiddenOn={footerHiddenOnText(
                pages
                  .filter((page) => page.published)
                  .map((page) => ({ title: page.title, hidden: page.hideFooter })),
              )}
              seoLinks={props.seoLinks}
              readOnly={readOnly}
              lookReadOnly={lookReadOnly}
              placeDefinitions={places.footer}
              widgets={widgets}
              canDefine={props.canDefine}
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
                aria-disabled={footer.pending || !footer.unsaved ? true : undefined}
                onClick={() => {
                  if (!footer.pending && footer.unsaved) void footer.save()
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
              <Button
                type="submit"
                loading={save.isPending && !publish.isPending}
                aria-disabled={!unsaved ? true : undefined}
              >
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
        footer={footer.shown}
        pages={pages}
        contacts={contacts ?? { phone: '', address: '' }}
        organization={props.footer.contacts ?? emptyFooterContacts}
        legal={{
          // Политика — ссылкой, только если опубликована: как на сайте
          policyHref: props.footer.policy.published
            ? canonicalPath(props.footer.policy.slug)
            : null,
          consentHref: props.footer.consent.published
            ? siteLinkHref({ page: props.footer.consent.slug })
            : null,
          cookieSettings: props.footer.cookieSettings,
        }}
        places={[...places.header, ...places.footer]}
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
  footer: Footer
  pages: readonly HeaderTargetPage[]
  contacts: { phone: string; address: string }
  organization: FooterContacts
  legal: { policyHref: string | null; consentHref: string | null; cookieSettings: boolean }
  /** Свои виды шапки и подвала (у владельца — и черновики): их можно выбрать до публикации */
  places: readonly CustomBlockDraft[]
  /** Что сейчас настраивают: на вкладке «Подвал» предпросмотр прокручен к низу страницы */
  focus: 'header' | 'footer'
}

/**
 * Предпросмотр шапки и подвала на главной — с темой сайта и теми же компонентами, что на сайте
 * (стандартные или свой вид). Пустая главная — пример лендинга. Ссылки меню ведут и на
 * неопубликованное: так видно черновик целиком. Свой вид со скриптом — по флажку в изолированной
 * рамке, как на экране своего блока
 */
function HeaderPreview(props: PreviewProps) {
  const { siteId, siteName, theme, header, pages, focus } = props
  const [device, setDevice] = useState<Device>(initialDevice)
  const [runScripts, setRunScripts] = useState(false)
  const main = useQuery(pageQuery(siteId, MAIN_PAGE_SLUG))
  const library = useQuery(mediaQuery(siteId))
  const media = useMemo(() => mediaMapOf(library.data?.items ?? []), [library.data])
  // Главная со своими блоками (le-english): без их определений на их месте было бы «блока нет»
  const published = useCustomBlockMap(siteId)
  const customBlocks = useMemo(
    () => ({ ...published, ...Object.fromEntries(props.places.map((one) => [one.key, one])) }),
    [published, props.places],
  )
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
  const chrome = siteChrome({
    header,
    footer: props.footer,
    siteName,
    page: { slug: MAIN_PAGE_SLUG, content },
    pages,
    contacts: props.contacts,
    organization: props.organization,
    legal: props.legal,
    customBlocks,
    media,
  })
  const subject = focus === 'footer' ? 'подвал' : 'шапка'
  // На вкладке «Подвал» предпросмотр прокручивается вниз при смене подвала или устройства,
  // а не на каждую перерисовку
  const scrollKey = focus === 'footer' ? JSON.stringify([device, props.footer]) : undefined
  const title = focus === 'footer' ? 'Предпросмотр подвала' : 'Предпросмотр шапки'
  const scripted = runScripts && chrome.scripts.length > 0
  return (
    <section aria-label={title} className={styles.preview}>
      <div className={styles.previewBar}>
        <p className={styles.note}>
          {empty
            ? `Главная пока пустая — ${subject} показан${focus === 'footer' ? '' : 'а'} с примером лендинга. `
            : 'Предпросмотр на главной — с настоящей темой сайта. '}
          На сайт {subject} попадёт после публикации.
        </p>
        <DeviceSwitch value={device} onChange={setDevice} />
      </div>
      {chrome.scripts.length > 0 && (
        <Checkbox
          label="Выполнять скрипты своих шапки и подвала"
          hint="В изолированной рамке: скриптам недоступны вход в админку и её данные, рамку на чужой адрес браузер не пускает. Скрипт в рамке может передать введённое в ней наружу (WebRTC, CSP это не закрывает): не вводите в предпросмотре пароли и личные данные, черновик от ИИ сначала прочитайте. Запускаются только скрипты определений; поведение шапки Averra (Esc, закрытие меню после выбора пункта, сжатие при прокрутке) видно только на сайте"
          checked={runScripts}
          onChange={(event) => setRunScripts(event.currentTarget.checked)}
        />
      )}
      <div className={styles.frame}>
        {scripted ? (
          <SandboxPreview
            title={`${title} со скриптами`}
            content={content}
            theme={theme}
            media={media}
            device={device}
            customBlocks={customBlocks}
            scripts={chrome.scripts}
            before={chrome.before}
            extra={chrome.extra}
            placeKeys={chrome.placeKeys}
          />
        ) : (
          <Preview
            title={title}
            content={content}
            theme={theme}
            media={media}
            device={device}
            selectedId={null}
            customBlocks={customBlocks}
            before={chrome.before}
            extra={chrome.extra}
            placeKeys={chrome.placeKeys}
            scrollToEnd={scrollKey}
          />
        )}
      </div>
    </section>
  )
}

/**
 * Свои блоки с местом «шапка» и «подвал»: опубликованное определение, нет его — черновик (его
 * видит только владелец). По месту — для выбора в своей вкладке
 */
function placeDefinitions(blocks: readonly { draft: unknown; published: unknown }[]) {
  const definitions = blocks.flatMap((block) => {
    const parsed = CustomBlockDraft.safeParse(block.published ?? block.draft)
    return parsed.success ? [parsed.data] : []
  })
  return {
    header: definitions.filter((one) => one.placement === 'header'),
    footer: definitions.filter((one) => one.placement === 'footer'),
  }
}
