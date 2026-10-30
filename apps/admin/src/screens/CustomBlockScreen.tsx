import {
  CUSTOM_FILTERS,
  type CustomBlockProblem,
  customBlockProblems,
} from '@averra/blocks/custom-engine'
import {
  BLOCK_CATEGORIES,
  type BlockCategory,
  blocks as builtinBlocks,
  CustomBlockDraft,
  type CustomBlockDraftInput,
  type CustomFieldInput,
  customBlockProps,
  customBlockType,
  exampleIssues,
  PageContent,
} from '@averra/schema'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import type { InferResponseType } from 'hono/client'
import { type RefObject, useDeferredValue, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { api } from '../api'
import { blockStatus } from '../custom-blocks/custom-block-format'
import { FieldsBuilder } from '../custom-blocks/FieldsBuilder'
import { type Device, DeviceSwitch, initialDevice, Preview } from '../editor/Preview'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { zodFieldErrors } from '../forms/field-errors'
import type { JsonSchema } from '../forms/json-schema'
import { type FieldProps, SchemaForm, type Widgets } from '../forms/SchemaForm'
import { ImageField } from '../media/ImageField'
import { mediaMapOf } from '../media/media-format'
import { formatDateTime } from '../pages-format'
import {
  customBlockQuery,
  customBlockRevisionsQuery,
  mediaQuery,
  queryKeys,
  siteQuery,
} from '../queries'
import { UnsavedChangesGuard, useReportUnsaved } from '../seo/unsaved'
import { Button, iconButtonClassName } from '../ui/Button'
import { CodeEditor, type LineMark } from '../ui/CodeEditor'
import { lineRange } from '../ui/code-highlight'
import { Select, TextInput } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { FormActions, monoClassName, Screen } from '../ui/Screen'
import { StatusPill } from '../ui/StatusPill'
import { Tabs } from '../ui/Tabs'
import { usePageTitle } from '../ui/use-page-title'
import { useSiteId } from '../use-site'
import styles from './CustomBlockScreen.module.scss'

const route = getRouteApi('/_app/blocks/$key')

type Part = 'basics' | 'fields' | 'template' | 'css' | 'example' | 'history'
type Notice = { tone: 'success' | 'danger' | 'warning'; text: string }
type BlockGet = (typeof api.sites)[':siteId']['custom-blocks'][':key']['$get']
/** Свой блок, как его отдаёт API: черновик, опубликованное, замечания и где стоит */
type View = InferResponseType<BlockGet, 200>

/** Экран своего блока: настройки, поля, шаблон, CSS, пример и живой предпросмотр */
export function CustomBlockScreen() {
  const { key } = route.useParams()
  const siteId = useSiteId()
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { data: view } = useSuspenseQuery(customBlockQuery(siteId, key))
  usePageTitle(view.draft?.title ?? key, 'свой блок')
  return (
    <Screen>
      <UnsavedChangesGuard>
        <CustomBlockEditor key={key} siteId={siteId} theme={site.theme} view={view} />
      </UnsavedChangesGuard>
    </Screen>
  )
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function CustomBlockEditor({
  siteId,
  theme,
  view,
}: {
  siteId: string
  theme: Parameters<typeof Preview>[0]['theme']
  view: View
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState<CustomBlockDraftInput>(
    () => (view.draft ?? view.published ?? { key: view.key }) as CustomBlockDraftInput,
  )
  const [saved, setSaved] = useState<unknown>(view.draft)
  const [published, setPublished] = useState(view.published !== null)
  const [unpublished, setUnpublished] = useState(view.unpublished)
  const [part, setPart] = useState<Part>('fields')
  const [notice, setNotice] = useState<Notice>()
  const templateRef = useRef<HTMLTextAreaElement>(null)
  const cssRef = useRef<HTMLTextAreaElement>(null)

  // Разбор — по значению формы, а не на каждую перерисовку: иначе draft новый каждый раз, и
  // замечания с предпросмотром пересчитывались бы без правок
  const parsed = useMemo(() => CustomBlockDraft.safeParse(form), [form])
  const structureErrors = zodFieldErrors(parsed.error)
  const draft = parsed.success ? parsed.data : null
  // Замечания и предпросмотр — с отставанием от набора: разбор Liquid, пробный рендер и сборка CSS
  // не должны тормозить ввод на тяжёлом шаблоне. Сохраняется всегда свежий draft
  const deferredDraft = useDeferredValue(draft)
  // Замечания — тем же движком, что проверяет API при публикации (кроме картинок медиатеки:
  // их API проверит сам)
  const problems = useMemo(
    () => (deferredDraft ? customBlockProblems(deferredDraft) : []),
    [deferredDraft],
  )
  const errorCount = problems.filter((problem) => problem.level === 'error').length
  const unsaved = !same(form, saved)
  useReportUnsaved(unsaved)

  // Пока определение не проходит схему, предпросмотр показывает последнее целое
  const lastGood = useRef(deferredDraft)
  if (deferredDraft) lastGood.current = deferredDraft
  const shown = deferredDraft ?? lastGood.current

  const change = (next: Partial<CustomBlockDraftInput>) => {
    setForm((current) => ({ ...current, ...next }))
    setNotice(undefined)
  }

  const blockApi = api.sites[':siteId']['custom-blocks'][':key']
  const param = { siteId, key: view.key }
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.customBlocks(siteId), exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.customBlockRevisions(siteId, view.key) }),
    ])

  const save = useMutation({
    mutationFn: async (body: CustomBlockDraft) => {
      const res = await blockApi.$put({ param, json: body })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })
  // Публикуется черновик, который человек видел: если его поменял токен MCP, API ответит 409
  const publish = useMutation({
    mutationFn: async (seen: CustomBlockDraft) => {
      const res = await blockApi.publish.$post({ param, json: { draft: seen } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })
  const remove = useMutation({
    mutationFn: async () => {
      const res = await blockApi.$delete({ param })
      if (res.status !== 204) throw await apiRequestError(res)
    },
  })

  const accept = (next: { draft: unknown; published: unknown; unpublished: boolean }) => {
    setSaved(next.draft)
    setForm(next.draft as CustomBlockDraftInput)
    setPublished(next.published !== null)
    setUnpublished(next.unpublished)
  }

  /** Сохраняет форму и возвращает черновик, как его записал API; не вышло — null */
  async function saveDraft() {
    if (!draft) {
      setNotice({ tone: 'danger', text: 'Не сохранить: поправьте отмеченные настройки полей' })
      setPart(parsed.error?.issues[0]?.path[0] === 'fields' ? 'fields' : 'basics')
      return null
    }
    try {
      const result = await save.mutateAsync(draft)
      accept(result)
      await refresh()
      return result.draft
    } catch (error) {
      setNotice({ tone: 'danger', text: `Не удалось сохранить: ${messageOf(error)}` })
      return null
    }
  }

  // Черновик поменяли со стороны (токен MCP): показываем свежий, публиковать его человек решит сам
  async function reload() {
    const res = await blockApi.$get({ param })
    if (res.status === 200) accept(await res.json())
    await refresh()
  }

  async function onPublish() {
    setNotice(undefined)
    const seen = unsaved ? await saveDraft() : CustomBlockDraft.safeParse(saved).data
    if (!seen) {
      if (!unsaved)
        setNotice({ tone: 'danger', text: 'Черновик не подходит под схему: сохраните его заново' })
      return
    }
    try {
      const result = await publish.mutateAsync(seen)
      accept(result)
      await refresh()
      setNotice(
        result.affected.length > 0
          ? {
              tone: 'warning',
              text: `Опубликовано. Данные блока не подходят на страницах: ${result.affected
                .map((page) => `«${page.title}» — ${page.message}`)
                .join(
                  '; ',
                )}. Там блок не покажется на сайте, пока страницу не поправят и не опубликуют`,
            }
          : {
              tone: 'success',
              text: 'Опубликовано: блок есть в каталоге редактора, сайт пересобирается',
            },
      )
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        await reload()
        setNotice({ tone: 'warning', text: messageOf(error) })
        return
      }
      const issues = error instanceof ApiRequestError ? error.issues : []
      const list = issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
      setNotice({
        tone: 'danger',
        text: `Не опубликовано: ${list || messageOf(error)}`,
      })
    }
  }

  async function onDelete() {
    if (!window.confirm(`Удалить свой блок «${form.title}»? Историю его публикаций тоже`)) return
    try {
      await remove.mutateAsync()
      await queryClient.invalidateQueries({ queryKey: queryKeys.customBlocks(siteId) })
      await navigate({ to: '/blocks' })
    } catch (error) {
      setNotice({ tone: 'danger', text: `Не удалось удалить: ${messageOf(error)}` })
    }
  }

  const jump = (ref: RefObject<HTMLTextAreaElement | null>, code: string, line: number) => {
    const area = ref.current
    if (!area) return
    const { start, end } = lineRange(code, line)
    area.focus()
    area.setSelectionRange(start, end)
  }

  const byPart = (target: CustomBlockProblem['part']) =>
    problems.filter((problem) => problem.part === target)
  const count = (target: CustomBlockProblem['part']) =>
    byPart(target).filter((problem) => problem.level === 'error').length || undefined
  const structureCount = (prefix: string) =>
    Object.keys(structureErrors).filter((path) => path.startsWith(prefix)).length || undefined

  const status = blockStatus({ published, unpublished, unsaved })
  const pending = save.isPending || publish.isPending

  return (
    <>
      <PageHeader
        eyebrow="Свой блок"
        title={form.title || view.key}
        back={
          <Link
            to="/blocks"
            className={iconButtonClassName({ variant: 'secondary' })}
            aria-label="К своим блокам"
            title="К своим блокам"
          >
            <Icon name="chevron-left" />
          </Link>
        }
        meta={
          <>
            <span className={monoClassName}>{customBlockType(view.key)}</span>{' '}
            <StatusPill tone={status.tone} appearance="dot">
              {status.text}
            </StatusPill>
          </>
        }
        actions={
          <Button
            icon="trash"
            variant="ghost"
            loading={remove.isPending}
            onClick={() => void onDelete()}
          >
            Удалить
          </Button>
        }
      />
      {view.usage.length > 0 && (
        <p className={styles.usage}>
          Стоит на страницах: {view.usage.map((page) => `«${page.title}»`).join(', ')}
        </p>
      )}
      <div className={styles.layout}>
        <div className={styles.settings}>
          <Tabs
            label="Части блока"
            value={part}
            onChange={setPart}
            panelFocusable={false}
            items={[
              { id: 'basics', label: 'Основное', count: structureCount('title') },
              { id: 'fields', label: 'Поля', count: structureCount('fields') },
              { id: 'template', label: 'Шаблон', count: count('template') },
              { id: 'css', label: 'CSS', count: count('css') },
              { id: 'example', label: 'Пример', count: count('example') },
              { id: 'history', label: 'История' },
            ]}
          >
            {part === 'basics' && <Basics form={form} errors={structureErrors} onChange={change} />}
            {part === 'fields' && (
              <div className={styles.panel}>
                <p className={styles.note}>
                  Поля видит редактор страницы. Ключ поля — имя переменной в шаблоне.
                </p>
                <FieldsBuilder
                  fields={(form.fields ?? []) as CustomFieldInput[]}
                  onChange={(fields) => change({ fields })}
                  errors={structureErrors}
                  path="fields"
                />
              </div>
            )}
            {part === 'template' && (
              <div className={styles.panel}>
                <CodeEditor
                  label="Шаблон Liquid"
                  hint="HTML блока: {{ поле }} выводит значение (оно экранировано), {% for %} и {% if %} — циклы и условия. Без script и обработчиков on…"
                  language="liquid"
                  value={form.template ?? ''}
                  onChange={(template) => change({ template })}
                  marks={marksOf(byPart('template'))}
                  textareaRef={templateRef}
                />
                <ProblemList
                  problems={byPart('template')}
                  onJump={(line) => jump(templateRef, form.template ?? '', line)}
                />
                <Cheatsheet fields={draft?.fields ?? []} />
              </div>
            )}
            {part === 'css' && (
              <div className={styles.panel}>
                <CodeEditor
                  label="CSS блока"
                  hint="Каждое правило — только внутри блока, :scope — сам блок. Цвета и шрифты — переменными темы: var(--color-text), var(--font-heading)"
                  language="css"
                  value={form.css ?? ''}
                  onChange={(css) => change({ css })}
                  marks={marksOf(byPart('css'))}
                  textareaRef={cssRef}
                />
                <ProblemList
                  problems={byPart('css')}
                  onJump={(line) => jump(cssRef, form.css ?? '', line)}
                />
              </div>
            )}
            {part === 'example' && (
              <ExamplePanel siteId={siteId} draft={draft} form={form} onChange={change} />
            )}
            {part === 'history' && (
              <HistoryPanel
                siteId={siteId}
                blockKey={view.key}
                unsaved={unsaved}
                onRestored={(next) => {
                  accept(next)
                  setNotice({
                    tone: 'success',
                    text: 'Версия возвращена в черновик. На сайт она попадёт после публикации',
                  })
                }}
              />
            )}
          </Tabs>

          <div className={styles.actions}>
            {notice && (
              <InlineAlert tone={notice.tone} live>
                {notice.text}
              </InlineAlert>
            )}
            {errorCount > 0 && (
              <p className={styles.note}>
                Ошибок: {errorCount} — сохранить можно, опубликовать нельзя. Они отмечены на
                вкладках.
              </p>
            )}
            <FormActions>
              <Button
                loading={save.isPending && !publish.isPending}
                aria-disabled={!unsaved || pending ? true : undefined}
                onClick={() => {
                  if (unsaved && !pending)
                    void saveDraft().then(
                      (ok) =>
                        ok &&
                        setNotice({
                          tone: 'success',
                          text: 'Черновик сохранён. На сайт он попадёт после публикации',
                        }),
                    )
                }}
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
            </FormActions>
          </div>
        </div>
        <BlockPreview siteId={siteId} theme={theme} draft={shown} />
      </div>
    </>
  )
}

/** Строки с замечаниями для поля кода: ошибка главнее предупреждения */
function marksOf(problems: readonly CustomBlockProblem[]) {
  const marks = new Map<number, LineMark>()
  for (const problem of problems) {
    if (problem.line === undefined) continue
    if (marks.get(problem.line) !== 'error') marks.set(problem.line, problem.level)
  }
  return marks
}

/** Замечания под полем кода: кнопка со строкой переводит курсор на неё */
function ProblemList({
  problems,
  onJump,
}: {
  problems: readonly CustomBlockProblem[]
  onJump: (line: number) => void
}) {
  if (problems.length === 0) {
    return (
      <p className={styles.ok} role="status">
        <Icon name="check" size={16} /> Замечаний нет
      </p>
    )
  }
  return (
    <ul className={styles.problems} aria-label="Замечания">
      {problems.map((problem, index) => (
        <li key={index} className={styles.problem} data-level={problem.level}>
          <StatusPill tone={problem.level === 'error' ? 'danger' : 'warning'}>
            {problem.level === 'error' ? 'Ошибка' : 'Совет'}
          </StatusPill>
          {problem.line !== undefined ? (
            <button type="button" className={styles.jump} onClick={() => onJump(problem.line ?? 1)}>
              Строка {problem.line}
            </button>
          ) : null}
          <span>{problem.message}</span>
        </li>
      ))}
    </ul>
  )
}

const categories = Object.entries(BLOCK_CATEGORIES) as [BlockCategory, string][]

/** Название, описание, раздел каталога и набросок */
function Basics({
  form,
  errors,
  onChange,
}: {
  form: CustomBlockDraftInput
  errors: Readonly<Partial<Record<string, string>>>
  onChange: (next: Partial<CustomBlockDraftInput>) => void
}) {
  return (
    <div className={styles.panel}>
      <TextInput
        label="Название"
        hint="Так блок называется в каталоге редактора"
        value={form.title ?? ''}
        maxChars={60}
        error={errors.title}
        onChange={(event) => onChange({ title: event.target.value })}
      />
      <TextInput
        label="Описание одной фразой"
        hint="Чем блок полезен: его видят каталог и нейронка в MCP"
        value={form.description ?? ''}
        maxChars={160}
        error={errors.description}
        onChange={(event) => onChange({ description: event.target.value })}
      />
      <Select
        label="Раздел каталога"
        hint="Где блок обычно стоит на странице. В каталоге он ещё и в разделе «Свои»"
        value={form.category ?? 'about'}
        onChange={(event) => {
          const category = categories.find(([id]) => id === event.target.value)?.[0]
          if (category) onChange({ category })
        }}
      >
        {categories.map(([id, title]) => (
          <option key={id} value={id}>
            {title}
          </option>
        ))}
      </Select>
      <Select
        label="Набросок в каталоге"
        hint="Рисунок карточки в «Добавить блок»: как у похожего встроенного блока"
        value={form.sketch ?? ''}
        onChange={(event) => {
          const sketch = builtinBlocks.find((block) => block.type === event.target.value)?.type
          onChange({ sketch })
        }}
      >
        <option value="">Общий набросок своего блока</option>
        {builtinBlocks.map((block) => (
          <option key={block.type} value={block.type}>
            Как «{block.title}»
          </option>
        ))}
      </Select>
    </div>
  )
}

/** Пример данных — той же формой, что у редактора страницы: с ним блок встаёт на страницу */
function ExamplePanel({
  siteId,
  draft,
  form,
  onChange,
}: {
  siteId: string
  draft: CustomBlockDraft | null
  form: CustomBlockDraftInput
  onChange: (next: Partial<CustomBlockDraftInput>) => void
}) {
  const widgets = useMemo<Widgets>(
    () => ({ image: (props: FieldProps) => <ImageField {...props} siteId={siteId} /> }),
    [siteId],
  )
  const schema = useMemo(
    () =>
      draft
        ? (z.toJSONSchema(customBlockProps(draft.fields), { io: 'input' }) as JsonSchema)
        : undefined,
    [draft],
  )
  if (!draft || !schema) {
    return (
      <InlineAlert tone="warning">
        Пример заполняется по полям блока: сначала поправьте ошибки во вкладке «Поля».
      </InlineAlert>
    )
  }
  const errors = Object.fromEntries(
    exampleIssues(draft).map((issue) => [issue.path.replace(/^example\.?/, ''), issue.message]),
  )
  return (
    <div className={styles.panel}>
      <p className={styles.note}>
        С этими данными блок встаёт на страницу из каталога, их же видят предпросмотр и нейронка в
        MCP. Цифр и фактов не выдумывайте: заглушки — в квадратных скобках.
      </p>
      <SchemaForm
        schema={schema}
        value={(form.example ?? {}) as Record<string, unknown>}
        errors={errors}
        onChange={(example) => onChange({ example })}
        widgets={widgets}
      />
    </div>
  )
}

/** Шпаргалка: переменные блока и свои фильтры */
function Cheatsheet({ fields }: { fields: readonly CustomFieldInput[] }) {
  const lines = fields.map((field) =>
    field.type === 'repeater'
      ? `{% for item in ${field.name} %} {{ item.${'fields' in field ? (field.fields[0]?.name ?? 'поле') : 'поле'} }} {% endfor %}`
      : field.type === 'image'
        ? `{{ ${field.name} | image: '100vw' }}`
        : field.type === 'link'
          ? `<a href="{{ ${field.name} | link }}">{{ ${field.name}.label }}</a>`
          : field.type === 'textarea'
            ? `{{ ${field.name} | paragraphs }}`
            : `{{ ${field.name} }}`,
  )
  return (
    <details className={styles.cheatsheet}>
      <summary>Переменные и фильтры</summary>
      <ul className={styles.code}>
        {lines.map((line, index) => (
          <li key={index} className={monoClassName}>
            {line}
          </li>
        ))}
        <li className={monoClassName}>{'{{ block.id }}'} — id блока на странице (якорь)</li>
      </ul>
      <p className={styles.note}>
        Свои фильтры: {CUSTOM_FILTERS.join(', ')}. image — адаптивная картинка с alt из поля, link —
        безопасная ссылка, paragraphs и newline_to_br — абзацы и переносы строк, accent — слова в
        *звёздочках* в {'<em>'}. Подробнее — в документации, «Свои блоки».
      </p>
    </details>
  )
}

/** История публикаций: вернуть версию в черновик */
function HistoryPanel({
  siteId,
  blockKey,
  unsaved,
  onRestored,
}: {
  siteId: string
  blockKey: string
  unsaved: boolean
  onRestored: (view: { draft: unknown; published: unknown; unpublished: boolean }) => void
}) {
  const { data, error, isPending } = useQuery(customBlockRevisionsQuery(siteId, blockKey))
  const restore = useMutation({
    mutationFn: async (revisionId: string) => {
      const res = await api.sites[':siteId']['custom-blocks'][':key'].revisions[
        ':revisionId'
      ].restore.$post({
        param: { siteId, key: blockKey, revisionId },
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })
  if (isPending) return <p role="status">Загружаем историю…</p>
  if (error) return <InlineAlert tone="danger">{messageOf(error)}</InlineAlert>
  if (data.length === 0) {
    return <p className={styles.note}>Блок ещё не публиковали: истории нет.</p>
  }
  return (
    <div className={styles.panel}>
      {restore.error && <InlineAlert tone="danger">{messageOf(restore.error)}</InlineAlert>}
      <ol className={styles.revisions}>
        {data.map((revision, index) => (
          <li key={revision.id} className={styles.revision}>
            <span>
              Версия {revision.version} · {formatDateTime(revision.publishedAt)}
              {revision.author && ` · ${revision.author}`}
              {index === 0 && ' · на сайте'}
            </span>
            <Button
              size="small"
              loading={restore.isPending && restore.variables === revision.id}
              onClick={() => {
                if (unsaved && !window.confirm('Несохранённые правки пропадут. Вернуть версию?'))
                  return
                void restore.mutateAsync(revision.id).then(onRestored)
              }}
            >
              Вернуть в черновик
            </Button>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Живой предпросмотр: блок с примером данных на настоящем рендере, в теме сайта */
function BlockPreview({
  siteId,
  theme,
  draft,
}: {
  siteId: string
  theme: Parameters<typeof Preview>[0]['theme']
  draft: CustomBlockDraft | null
}) {
  // «Десктоп» (1280 px) в колонке предпросмотра ужат вдвое и не читается: начинаем с планшета
  const [device, setDevice] = useState<Device>(() =>
    initialDevice() === 'phone' ? 'phone' : 'tablet',
  )
  const library = useQuery(mediaQuery(siteId))
  const media = useMemo(() => mediaMapOf(library.data?.items ?? []), [library.data])
  const content = useMemo(
    () =>
      PageContent.parse({
        blocks: draft
          ? [{ id: 'preview', type: customBlockType(draft.key), props: draft.example }]
          : [],
      }),
    [draft],
  )
  const definitions = useMemo(() => (draft ? { [draft.key]: draft } : {}), [draft])
  return (
    <section aria-label="Предпросмотр блока" className={styles.preview}>
      <div className={styles.previewBar}>
        <p className={styles.note}>Пример данных в теме сайта — правки видны сразу</p>
        <DeviceSwitch value={device} onChange={setDevice} />
      </div>
      <div className={styles.frame}>
        <Preview
          title="Предпросмотр своего блока"
          content={content}
          theme={theme}
          media={media}
          device={device}
          selectedId={null}
          customBlocks={definitions}
        />
      </div>
    </section>
  )
}
