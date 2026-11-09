import { compileWindowCss } from '@averra/blocks'
import {
  browserColorTitles,
  demoPage,
  focusContrast,
  MAIN_PAGE_SLUG,
  PageContent,
  presetOf,
  sameTheme,
  type Theme,
  ThemeBackgroundSize,
  type ThemeColorRole,
  ThemeInput,
  type ThemePresetId,
  ThemeRadius,
  themeBackgroundSizeTitles,
  themeColorRoles,
  themeColorTitles,
  themePresets,
  themeRadiusTitles,
} from '@averra/schema'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { type FormEvent, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useCustomBlockMap } from '../custom-blocks/use-custom-block-map'
import { type Device, DeviceSwitch, initialDevice, Preview } from '../editor/Preview'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { useFormErrors } from '../forms/use-form-errors'
import { MediaPickField } from '../media/MediaPickField'
import { mediaMapOf } from '../media/media-format'
import { canEditTheme } from '../permissions'
import { mediaQuery, pageQuery, pagesQuery, queryKeys, siteQuery, themeQuery } from '../queries'
import { fieldError } from '../seo/seo-format'
import { UnsavedChangesGuard, useReportUnsaved } from '../seo/unsaved'
import { ColorRow, ThemeSwatch } from '../theme/ThemeParts'
import {
  checksOf,
  contrastText,
  fontGroups,
  fontRoleTitles,
  fontTitle,
  formOf,
  normalizeHex,
  refusedField,
  rowCheck,
  type ThemeForm,
  themeInputOf,
  themeOf,
  themeStatus,
} from '../theme/theme-format'
import { Button } from '../ui/Button'
import { CodeEditor } from '../ui/CodeEditor'
import { Select, TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { FormActions, formClassName, Screen, Section } from '../ui/Screen'
import { SegmentedControl } from '../ui/SegmentedControl'
import { StatusPill } from '../ui/StatusPill'
import { usePageTitle } from '../ui/use-page-title'
import { useSiteId } from '../use-site'
import styles from './ThemeScreen.module.scss'

type Notice = { kind: 'done' | 'error'; text: string }

/** Карточка «своей» темы среди готовых: ни одна не выбрана, пока тема с ними не совпадает */
const CUSTOM = 'custom'

/**
 * Тема сайта по концепту: готовые темы, цвета с живой проверкой контраста, шрифты, скругления,
 * а справа — предпросмотр на настоящих страницах сайта теми же компонентами, что собирают сайт.
 * «Сохранить» — черновик темы, «Опубликовать» — тема на сайте (сайт пересобирается)
 */
export function ThemeScreen() {
  const siteId = useSiteId()
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { data: view } = useSuspenseQuery(themeQuery(siteId))
  usePageTitle('Тема', site.name)
  return (
    <Screen>
      <PageHeader
        eyebrow={site.name}
        title="Тема сайта"
        meta="Цвета, шрифты и форма — на весь сайт сразу"
      />
      <UnsavedChangesGuard>
        <ThemeEditor
          siteId={siteId}
          draft={view.draft}
          unpublished={view.unpublished}
          readOnly={!canEditTheme(site.access)}
        />
      </UnsavedChangesGuard>
    </Screen>
  )
}

type EditorProps = { siteId: string; draft: Theme; unpublished: boolean; readOnly: boolean }

function ThemeEditor({ siteId, draft, unpublished, readOnly }: EditorProps) {
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const windowCssRef = useRef<HTMLTextAreaElement>(null)
  const [form, setForm] = useState<ThemeForm>(() => formOf(draft))
  const [notice, setNotice] = useState<Notice>()
  // Цвет, который меняли последним: на него фокус, если сохранить не дали из-за него
  const lastColor = useRef<ThemeColorRole | undefined>(undefined)
  const theme = themeOf(form)
  // Черновик сменился на сервере (сохранили в другой вкладке, данные обновились): форма без
  // правок берёт новый черновик, иначе «Не сохранено» считалось бы против него, а поля — старые.
  // Правки человека не трогаем
  const [base, setBase] = useState(draft)
  if (!sameTheme(base, draft)) {
    setBase(draft)
    if (theme && sameTheme(theme, base)) setForm(formOf(draft))
  }
  const parsed = ThemeInput.safeParse(themeInputOf(form))
  const errors = useFormErrors(zodFieldErrors(parsed.error))
  const checks = checksOf(form)
  const unsaved = theme === undefined || !sameTheme(theme, draft)
  useReportUnsaved(unsaved)
  // Пока цвет недописан, предпросмотр и палитры показывают последнюю целую тему
  const shown = useRef(draft)
  if (theme) shown.current = theme
  const previewTheme = theme ?? shown.current

  const change = (next: ThemeForm, field?: string) => {
    setForm(next)
    setNotice(undefined)
    if (field) errors.clearServerError(field)
  }
  const setColor = (role: ThemeColorRole, value: string) => {
    lastColor.current = role
    change({ ...form, colors: { ...form.colors, [role]: normalizeHex(value) } }, `colors.${role}`)
  }

  const afterChange = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.site(siteId), exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.build(siteId) }),
    ])
  }

  const showError = (error: unknown, action: string) => {
    if (error instanceof ApiRequestError && error.issues.length > 0) {
      errors.showServerErrors(issueFieldErrors(error.issues))
      setNotice({ kind: 'error', text: `${action}: ${error.message}` })
      return
    }
    setNotice({ kind: 'error', text: `${action}: ${messageOf(error)}` })
  }

  const save = useMutation({
    mutationFn: async (body: Theme) => {
      const res = await api.sites[':siteId'].theme.$put({ param: { siteId }, json: body })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })
  const publish = useMutation({
    mutationFn: async () => {
      const res = await api.sites[':siteId'].theme.publish.$post({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })
  const pending = save.isPending || publish.isPending

  /** Форма не прошла проверку: ошибки у полей, фокус на изменённый цвет или первую ошибку */
  function refuse() {
    errors.attempt()
    const focusIssue = parsed.error?.issues.some((issue) => issue.path[0] === 'focus')
    setNotice({
      kind: 'error',
      text: checks.some((check) => check.blocking && !check.ok)
        ? 'Тему не сохранить: не хватает контраста. Поправьте отмеченные цвета'
        : focusIssue
          ? 'Тему не сохранить: кольцо фокуса — цвет #RRGGBB с контрастом от 3 к фону и поверхности'
          : 'Тему не сохранить: цвета — в формате #RRGGBB',
    })
    const name = refusedField(parsed.error?.issues ?? [], checks, lastColor.current)
    requestAnimationFrame(() => {
      const field = name ? formRef.current?.elements.namedItem(name) : null
      if (field instanceof HTMLElement) field.focus()
    })
  }

  /** В CSS окон ошибка: запрос не уходит, причина названа, фокус в поле над липкой полосой */
  function refuseWindowCss(line: number | undefined) {
    setNotice({
      kind: 'error',
      text: `Тему не сохранить: ошибка в CSS окон${line ? `, строка ${line}` : ''}. Поправьте её в разделе «Окна сайта»`,
    })
    requestAnimationFrame(() => {
      const field = windowCssRef.current
      if (!field) return
      field.scrollIntoView({ block: 'center' })
      field.focus({ preventScroll: true })
    })
  }

  async function saveDraft() {
    const cssError = windowCssProblems.find((problem) => problem.level === 'error')
    if (cssError) {
      refuseWindowCss(cssError.line)
      return false
    }
    if (!parsed.success) {
      refuse()
      return false
    }
    try {
      const saved = await save.mutateAsync(parsed.data)
      queryClient.setQueryData(queryKeys.theme(siteId), saved)
      // API приводит тему к одному виду (скругления по умолчанию) — форма берёт сохранённое
      setForm(formOf(saved.draft))
      errors.reset()
      return true
    } catch (error) {
      showError(error, 'Не удалось сохранить')
      return false
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Без правок сохранять нечего: кнопка выключена, Enter в поле тоже ничего не делает
    if (!unsaved) return
    setNotice(undefined)
    if (await saveDraft()) {
      setNotice({
        kind: 'done',
        text: 'Тема сохранена. На сайте она появится после публикации',
      })
    }
  }

  async function onPublish() {
    setNotice(undefined)
    if (unsaved && !(await saveDraft())) return
    try {
      const published = await publish.mutateAsync()
      queryClient.setQueryData(queryKeys.theme(siteId), published)
      setForm(formOf(published.draft))
      setNotice({
        kind: 'done',
        text: 'Тема опубликована. Сайт пересобирается — через минуту новая тема будет на нём',
      })
      await afterChange()
    } catch (error) {
      showError(error, 'Не удалось опубликовать')
    }
  }

  const preset = theme ? presetOf(theme) : undefined
  // CSS окон проверяется на лету тем же движком, что на сервере: ошибки и предупреждения со строкой
  const windowCssProblems = useMemo(
    () => (form.windowCss?.trim() ? compileWindowCss(form.windowCss).problems : []),
    [form.windowCss],
  )
  const status = themeStatus({ unsaved, unpublished })
  const blocking = checks.filter((check) => check.blocking && !check.ok)
  const warnings = checks.filter((check) => !check.blocking && !check.ok)

  return (
    <div className={styles.layout}>
      <form
        ref={formRef}
        aria-label="Тема сайта"
        className={`${formClassName} ${styles.settings}`}
        onSubmit={onSubmit}
        noValidate
      >
        {readOnly && (
          <InlineAlert tone="info" title="Только просмотр">
            Тему меняет владелец установки (студия): смена темы пересобирает весь сайт.
          </InlineAlert>
        )}
        <Section title="Готовые темы" card>
          <SegmentedControl<ThemePresetId | typeof CUSTOM>
            legend="Готовые темы"
            hideLegend
            appearance="cards"
            name="preset"
            disabled={readOnly}
            options={themePresets.map((item) => ({
              value: item.id,
              label: item.title,
              thumbnail: <ThemeSwatch theme={item.theme} />,
            }))}
            value={preset?.id ?? CUSTOM}
            onChange={(id) => {
              const picked = themePresets.find((item) => item.id === id)
              if (picked) change(formOf(picked.theme))
              errors.showServerErrors({})
            }}
          />
          <p className={styles.note}>
            {preset
              ? `Сейчас — «${preset.title}». Любую можно подправить ниже.`
              : 'Своя тема: цвета или шрифты отличаются от готовых.'}
          </p>
        </Section>

        <Section
          title="Цвета"
          description="Контраст пересчитывается сразу: текст — от 4,5, акцент как ссылка — от 3"
          card
        >
          <div className={styles.colors}>
            {themeColorRoles.map((role) => {
              return (
                <ColorRow
                  key={role}
                  colorRole={role}
                  title={themeColorTitles[role]}
                  value={form.colors[role]}
                  swatch={previewTheme.colors[role]}
                  check={rowCheck(role, checks)}
                  error={fieldError(errors.errors, `colors.${role}`)}
                  disabled={readOnly}
                  onChange={(value) => setColor(role, value)}
                />
              )
            })}
          </div>
          {blocking.length > 0 && (
            <InlineAlert tone="danger" title="Так сохранить нельзя">
              {blocking.map((check) => `${check.label}: ${contrastText(check)}`).join('; ')}. Текст
              или рамка фокуса будут плохо видны — поправьте цвета.
            </InlineAlert>
          )}
          {warnings.length > 0 && (
            <InlineAlert tone="warning" title="Стоит поправить">
              {warnings.map((check) => `${check.label}: ${contrastText(check)}`).join('; ')}.
              Сохранить можно, но эти цвета будут хуже заметны.
            </InlineAlert>
          )}
        </Section>

        <Section title="Шрифты" card>
          <div className={styles.fonts}>
            {(['heading', 'body', 'accent', 'mono'] as const).map((role) => (
              <Select
                key={role}
                label={fontRoleTitles[role]}
                hint={
                  role === 'accent'
                    ? 'Подписи и пометки в своих блоках'
                    : role === 'mono'
                      ? 'Номера и надзаголовки в своих блоках (var(--font-mono))'
                      : undefined
                }
                name={`fonts.${role}`}
                value={form.fonts[role] ?? ''}
                disabled={readOnly}
                onChange={(event) => {
                  const font = fontGroups
                    .flatMap((group) => group.fonts)
                    .find((item) => item === event.target.value)
                  if (font) {
                    change({ ...form, fonts: { ...form.fonts, [role]: font } })
                  } else if (role === 'accent' || role === 'mono') {
                    // «Как у заголовков» и «Шрифт устройства»: шрифт роли не задан
                    const { [role]: _unset, ...fonts } = form.fonts
                    change({ ...form, fonts })
                  }
                }}
              >
                {role === 'accent' && <option value="">Как у заголовков</option>}
                {role === 'mono' && <option value="">Моноширинный шрифт устройства</option>}
                {fontGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.fonts.map((font) => (
                      <option key={font} value={font}>
                        {fontTitle(font)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            ))}
          </div>
          <p className={styles.note}>
            Шрифты лежат на сервере сайта, с кириллицей. Google Fonts сайт не трогает, а посетитель
            скачивает только выбранные начертания. Акцентный шрифт не выбран — подписи в своих
            блоках набираются шрифтом заголовков.
          </p>
        </Section>

        <Section title="Скругления" card>
          <SegmentedControl
            legend="Скругления"
            hideLegend
            wrap
            name="radius"
            disabled={readOnly}
            options={ThemeRadius.options.map((radius) => ({
              value: radius,
              label: themeRadiusTitles[radius],
            }))}
            value={form.radius}
            onChange={(radius) => change({ ...form, radius })}
          />
        </Section>

        <Section
          title="Страница и браузер"
          description="Фон под всеми блоками, кольцо фокуса с клавиатуры и цвет строки браузера на телефоне"
          card
        >
          <MediaPickField
            siteId={siteId}
            label="Фон-картинка страницы"
            name="background.mediaId"
            value={form.background?.mediaId ?? null}
            disabled={readOnly}
            error={fieldError(errors.errors, 'background.mediaId')}
            onChange={(mediaId) => {
              const { background: _old, ...rest } = form
              change(
                mediaId
                  ? { ...rest, background: { mediaId, size: form.background?.size ?? 'tile' } }
                  : rest,
                'background.mediaId',
              )
            }}
            hint="Узор (зерно бумаги, лёгкая текстура) или картинка на всю страницу. Под ней — цвет «Фон»: текст проверен на нём, поэтому картинка — светлая и спокойная. Форматы PNG, JPEG, WebP; SVG для фона не подходит"
          />
          {form.background && (
            <SegmentedControl
              legend="Как лежит картинка"
              name="background.size"
              disabled={readOnly}
              options={ThemeBackgroundSize.options.map((size) => ({
                value: size,
                label: themeBackgroundSizeTitles[size],
              }))}
              value={form.background.size}
              onChange={(size) =>
                form.background && change({ ...form, background: { ...form.background, size } })
              }
            />
          )}
          <TextInput
            label="Кольцо фокуса"
            name="focus"
            mono
            spellCheck={false}
            maxLength={7}
            placeholder={form.colors.accent}
            value={form.focus ?? ''}
            disabled={readOnly}
            error={fieldError(errors.errors, 'focus')}
            onChange={(event) => {
              const value = normalizeHex(event.target.value)
              const { focus: _old, ...rest } = form
              change(value.trim() === '' ? rest : { ...rest, focus: value }, 'focus')
            }}
            hint={focusHint(theme)}
          />
          <Select
            label="Цвет строки браузера"
            name="browserColor"
            value={form.browserColor ?? ''}
            disabled={readOnly}
            hint="Полоса браузера на телефоне (Android): обычно фон или фирменный цвет"
            onChange={(event) => {
              const value = event.target.value
              const { browserColor: _old, ...rest } = form
              const role = (
                Object.keys(browserColorTitles) as (keyof typeof browserColorTitles)[]
              ).find((item) => item === value)
              change(role ? { ...rest, browserColor: role } : rest)
            }}
          >
            <option value="">Как фон</option>
            {(Object.keys(browserColorTitles) as (keyof typeof browserColorTitles)[])
              .filter((role) => role !== 'background')
              .map((role) => (
                <option key={role} value={role}>
                  {browserColorTitles[role]}
                </option>
              ))}
          </Select>
        </Section>

        <Section
          title="Окна сайта"
          description="Страницы, которые открываются окном поверх других (SEO страницы → «Окно»)"
          card
        >
          <CodeEditor
            label="Свой CSS окон"
            hint="Необязательно. :scope — само окно, «> section» — блоки окна. Цвета и шрифты — переменными темы: var(--color-surface), var(--font-heading). Проверяется так же, как CSS своих блоков"
            language="css"
            rows={8}
            textareaRef={windowCssRef}
            value={form.windowCss ?? ''}
            readOnly={readOnly}
            error={fieldError(errors.errors, 'windowCss')}
            onChange={(windowCss) => change({ ...form, windowCss }, 'windowCss')}
          />
          {windowCssProblems.length > 0 && (
            <InlineAlert
              tone={
                windowCssProblems.some((problem) => problem.level === 'error')
                  ? 'danger'
                  : 'warning'
              }
              title="В CSS окон"
            >
              <ul className={styles.problems}>
                {windowCssProblems.map((problem, index) => (
                  <li key={index}>
                    {problem.line ? `Строка ${problem.line}: ` : ''}
                    {problem.message}
                  </li>
                ))}
              </ul>
            </InlineAlert>
          )}
        </Section>

        {/* Кнопки и итог — прилипают к низу колонки: после правки цвета в середине формы не нужно
            листать до конца, а сообщение об отказе видно сразу у кнопок */}
        <div className={styles.actions}>
          {notice?.kind === 'error' && <InlineAlert tone="danger">{notice.text}</InlineAlert>}
          {notice?.kind === 'done' && (
            <InlineAlert tone="success" live>
              {notice.text}
            </InlineAlert>
          )}
          {!readOnly && (
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
            </FormActions>
          )}
        </div>
      </form>
      <ThemePreview siteId={siteId} theme={previewTheme} />
    </div>
  )
}

/**
 * Предпросмотр темы на страницах сайта: черновик выбранной страницы теми же компонентами, что в
 * редакторе и на сайте. Пустая страница — пример лендинга, чтобы было на чём смотреть тему
 */
function ThemePreview({ siteId, theme }: { siteId: string; theme: Theme }) {
  const { data: pages } = useSuspenseQuery(pagesQuery(siteId))
  const [slug, setSlug] = useState(MAIN_PAGE_SLUG)
  // На телефоне предпросмотр начинается с телефона: «десктоп» в масштабе там не прочитать
  const [device, setDevice] = useState<Device>(initialDevice)
  // Пока грузится другая страница, остаётся прежняя: пример лендинга на миг не мелькает
  const page = useQuery({ ...pageQuery(siteId, slug), placeholderData: keepPreviousData })
  const library = useQuery(mediaQuery(siteId))
  const media = useMemo(() => mediaMapOf(library.data?.items ?? []), [library.data])
  // Свои блоки страницы — в новой теме тоже: их CSS построен на ролях темы
  const customBlocks = useCustomBlockMap(siteId)
  const draft = page.data?.draft
  const empty = draft !== undefined && draft.blocks.length === 0
  const content = useMemo(
    () => (draft && !empty ? draft : PageContent.parse(demoPage)),
    [draft, empty],
  )
  return (
    <section aria-label="Предпросмотр темы" className={styles.preview}>
      <div className={styles.previewBar}>
        <Select
          label="Страница"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          className={styles.pageSelect}
        >
          {pages.map((item) => (
            <option key={item.slug} value={item.slug}>
              {item.title}
            </option>
          ))}
        </Select>
        <DeviceSwitch value={device} onChange={setDevice} />
      </div>
      <p className={styles.note}>
        {page.isError
          ? 'Страницу не загрузить — тема показана на примере лендинга. '
          : empty
            ? 'На странице пока нет блоков — тема показана на примере лендинга. '
            : 'Страница в теме с несохранёнными и неопубликованными правками. Редактор страницы показывает тему, которая сейчас на сайте. '}
        Правки видны сразу, на сайт попадут после публикации.
      </p>
      <div className={styles.frame} aria-busy={page.isFetching && page.isPlaceholderData}>
        {page.isPending ? (
          <p className={styles.loading} role="status">
            Загружаем страницу…
          </p>
        ) : (
          <Preview
            title="Предпросмотр темы"
            content={content}
            theme={theme}
            media={media}
            device={device}
            selectedId={null}
            customBlocks={customBlocks}
          />
        )}
      </div>
    </section>
  )
}

/** Подсказка у кольца фокуса: контраст своего цвета или что будет без него */
function focusHint(theme: Theme | undefined) {
  if (!theme?.focus) {
    return 'Пусто — цвет акцента. Свой цвет — если кольцо сливается с кнопками акцента: оно обводит кнопку с зазором'
  }
  const check = focusContrast(theme)
  return check?.ok
    ? `Контраст к фону и поверхности — ${check.ratio.toFixed(1).replace('.', ',')}: кольцо видно`
    : 'Нужен контраст от 3 к фону и поверхности'
}
