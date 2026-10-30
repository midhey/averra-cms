import {
  demoPage,
  MAIN_PAGE_SLUG,
  PageContent,
  presetOf,
  sameTheme,
  type Theme,
  type ThemeColorRole,
  ThemeInput,
  type ThemePresetId,
  ThemeRadius,
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
import { publishedDefinitions } from '../custom-blocks/custom-block-format'
import { type Device, DeviceSwitch, initialDevice, Preview } from '../editor/Preview'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { useFormErrors } from '../forms/use-form-errors'
import { mediaMapOf } from '../media/media-format'
import { canEditTheme } from '../permissions'
import {
  customBlocksQuery,
  mediaQuery,
  pageQuery,
  pagesQuery,
  queryKeys,
  siteQuery,
  themeQuery,
} from '../queries'
import { fieldError } from '../seo/seo-format'
import { UnsavedChangesGuard, useReportUnsaved } from '../seo/unsaved'
import { ColorRow, ThemeSwatch } from '../theme/ThemeParts'
import {
  checksOf,
  contrastText,
  fontGroups,
  fontTitle,
  formOf,
  normalizeHex,
  refusedField,
  rowCheck,
  type ThemeForm,
  themeOf,
  themeStatus,
} from '../theme/theme-format'
import { Button } from '../ui/Button'
import { Select } from '../ui/Field'
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
  const parsed = ThemeInput.safeParse(form)
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
    setNotice({
      kind: 'error',
      text: checks.some((check) => check.blocking && !check.ok)
        ? 'Тему не сохранить: не хватает контраста. Поправьте отмеченные цвета'
        : 'Тему не сохранить: цвета — в формате #RRGGBB',
    })
    const name = refusedField(parsed.error?.issues ?? [], checks, lastColor.current)
    requestAnimationFrame(() => {
      const field = name ? formRef.current?.elements.namedItem(name) : null
      if (field instanceof HTMLElement) field.focus()
    })
  }

  async function saveDraft() {
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
          <InlineAlert tone="info">
            Тему меняют владелец и редактор сайта: смена темы пересобирает весь сайт.
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
            {(['heading', 'body'] as const).map((role) => (
              <Select
                key={role}
                label={role === 'heading' ? 'Заголовки' : 'Текст'}
                name={`fonts.${role}`}
                value={form.fonts[role]}
                disabled={readOnly}
                onChange={(event) => {
                  const font = fontGroups
                    .flatMap((group) => group.fonts)
                    .find((item) => item === event.target.value)
                  if (font) change({ ...form, fonts: { ...form.fonts, [role]: font } })
                }}
              >
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
            скачивает только выбранные начертания.
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
  const custom = useQuery(customBlocksQuery(siteId))
  const customBlocks = useMemo(
    () =>
      Object.fromEntries(
        publishedDefinitions(custom.data?.blocks ?? []).map((item) => [item.key, item]),
      ),
    [custom.data],
  )
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
            : 'Черновик страницы в новой теме. '}
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
