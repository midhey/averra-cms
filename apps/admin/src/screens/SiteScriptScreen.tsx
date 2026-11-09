import {
  type CustomBlockProblem,
  customBlockScriptFile,
  scriptProblems,
  siteScriptFile,
} from '@averra/blocks/custom-engine'
import {
  customBlockKeysOf,
  demoPage,
  MAIN_PAGE_SLUG,
  PageContent,
  SiteScript,
  type SiteScriptInput,
} from '@averra/schema'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useCustomBlockMap } from '../custom-blocks/use-custom-block-map'
import { type Device, DeviceSwitch, initialDevice, Preview } from '../editor/Preview'
import { SandboxPreview } from '../editor/SandboxPreview'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { zodFieldErrors } from '../forms/field-errors'
import { mediaMapOf } from '../media/media-format'
import { mediaQuery, pageQuery, queryKeys, siteQuery, siteScriptQuery } from '../queries'
import { UnsavedChangesGuard, useReportUnsaved } from '../seo/unsaved'
import { Button } from '../ui/Button'
import { CodeEditor, type LineMark } from '../ui/CodeEditor'
import { lineRange } from '../ui/code-highlight'
import { Checkbox, TextArea } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { FormActions, Screen } from '../ui/Screen'
import { StatusPill } from '../ui/StatusPill'
import { usePageTitle } from '../ui/use-page-title'
import { useSiteId } from '../use-site'
import styles from './SiteScriptScreen.module.scss'

type Notice = { tone: 'success' | 'danger' | 'warning'; text: string }
type State = { draft: SiteScriptInput; published: SiteScriptInput; unpublished: boolean }

/** Форма экрана: код и домены одной строкой на домен */
type Form = { script: string; origins: string }

const formOf = (script: SiteScriptInput): Form => ({
  script: script.script ?? '',
  origins: (script.origins ?? []).join('\n'),
})

const scriptOf = (form: Form) =>
  SiteScript.safeParse({
    script: form.script,
    origins: form.origins
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  })

/**
 * «Скрипт сайта»: свой JS владельца на каждой странице и домены, которые ему нужны (CSP сайта).
 * Черновик и публикация; предпросмотр главной — обычный или со скриптами в изолированной рамке
 */
export function SiteScriptScreen() {
  const siteId = useSiteId()
  const { data: state } = useSuspenseQuery(siteScriptQuery(siteId))
  usePageTitle('Скрипт сайта')
  return (
    <Screen>
      <UnsavedChangesGuard>
        <SiteScriptEditor siteId={siteId} state={state} />
      </UnsavedChangesGuard>
    </Screen>
  )
}

function SiteScriptEditor({ siteId, state }: { siteId: string; state: State }) {
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState<Form>(() => formOf(state.draft))
  const [form, setForm] = useState<Form>(saved)
  const [unpublished, setUnpublished] = useState(state.unpublished)
  const [notice, setNotice] = useState<Notice>()
  const codeRef = useRef<HTMLTextAreaElement>(null)

  const parsed = useMemo(() => scriptOf(form), [form])
  const errors = zodFieldErrors(parsed.error)
  const originsError = Object.entries(errors).find(([path]) => path.startsWith('origins'))?.[1]
  const deferred = useDeferredValue(parsed.success ? parsed.data : null)
  // Замечания — тем же движком, что проверяет публикация
  const problems = useMemo(() => (deferred ? scriptProblems(deferred.script) : []), [deferred])
  const errorCount = problems.filter((problem) => problem.level === 'error').length
  const unsaved = form.script !== saved.script || form.origins !== saved.origins
  useReportUnsaved(unsaved)

  const scriptApi = api.sites[':siteId'].script
  const param = { siteId }
  const accept = (next: State) => {
    const nextForm = formOf(next.draft)
    setSaved(nextForm)
    setForm(nextForm)
    setUnpublished(next.unpublished)
    queryClient.setQueryData(queryKeys.siteScript(siteId), next)
  }
  const save = useMutation({
    mutationFn: async (body: SiteScript) => {
      const res = await scriptApi.$put({ param, json: body })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })
  const publish = useMutation({
    mutationFn: async (seen: SiteScript) => {
      const res = await scriptApi.publish.$post({ param, json: { draft: seen } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })
  const pending = save.isPending || publish.isPending

  async function saveDraft() {
    if (!parsed.success) {
      setNotice({ tone: 'danger', text: 'Не сохранить: поправьте домены' })
      return null
    }
    try {
      const result = await save.mutateAsync(parsed.data)
      accept(result)
      return result.draft
    } catch (error) {
      setNotice({ tone: 'danger', text: `Не удалось сохранить: ${messageOf(error)}` })
      return null
    }
  }

  async function onPublish() {
    setNotice(undefined)
    const seen = unsaved ? await saveDraft() : parsed.data
    if (!seen) return
    try {
      accept(await publish.mutateAsync(SiteScript.parse(seen)))
      setNotice({ tone: 'success', text: 'Опубликовано: сайт пересобирается' })
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        const res = await scriptApi.$get({ param })
        if (res.status === 200) accept(await res.json())
        setNotice({ tone: 'warning', text: messageOf(error) })
        return
      }
      setNotice({ tone: 'danger', text: `Не опубликовано: ${messageOf(error)}` })
    }
  }

  const jump = (line: number) => {
    const area = codeRef.current
    if (!area) return
    const { start, end } = lineRange(form.script, line)
    area.focus()
    area.setSelectionRange(start, end)
  }

  const status = unsaved
    ? { tone: 'warning' as const, text: 'Не сохранено' }
    : unpublished
      ? { tone: 'warning' as const, text: 'Есть неопубликованные правки' }
      : { tone: 'success' as const, text: 'Как на сайте' }

  return (
    <>
      <PageHeader
        title="Скрипт сайта"
        meta={
          <StatusPill tone={status.tone} appearance="dot">
            {status.text}
          </StatusPill>
        }
      />
      <div className={styles.layout}>
        <div className={styles.settings}>
          <p className={styles.note}>
            Свой JS на каждой странице сайта — улучшение поверх рабочего HTML: без него контент,
            ссылки и формы обязаны работать. На сайте скрипт — отдельным файлом, после загрузки
            страницы. Скрипты отдельных блоков — на вкладке «Скрипт» своего блока.
          </p>
          <CodeEditor
            label="Скрипт"
            hint="Тело функции: можно await, нельзя import. Ошибка в скрипте не ломает страницу и другие скрипты"
            language="js"
            value={form.script}
            onChange={(script) => {
              setForm((current) => ({ ...current, script }))
              setNotice(undefined)
            }}
            marks={marksOf(problems)}
            textareaRef={codeRef}
          />
          <ProblemList problems={problems} onJump={jump} />
          <TextArea
            label="Домены внешних скриптов"
            hint="Один на строку, например https://widget.example.ru. С них скрипту можно грузить код, стили, картинки, фреймы и делать запросы — их разрешит CSP сайта. Метрику и GA4 добавлять не нужно"
            mono
            rows={3}
            value={form.origins}
            error={originsError}
            onChange={(event) => {
              const origins = event.currentTarget.value
              setForm((current) => ({ ...current, origins }))
              setNotice(undefined)
            }}
          />
          <div className={styles.actions}>
            {notice && (
              <InlineAlert tone={notice.tone} live>
                {notice.text}
              </InlineAlert>
            )}
            {errorCount > 0 && (
              <p className={styles.note}>
                Ошибок: {errorCount} — сохранить можно, опубликовать нельзя.
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
        <ScriptPreview siteId={siteId} script={deferred?.script ?? ''} />
      </div>
    </>
  )
}

/** Строки с замечаниями для поля кода */
function marksOf(problems: readonly CustomBlockProblem[]) {
  const marks = new Map<number, LineMark>()
  for (const problem of problems) {
    if (problem.line === undefined) continue
    if (marks.get(problem.line) !== 'error') marks.set(problem.line, problem.level)
  }
  return marks
}

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
        <li key={index} className={styles.problem}>
          <StatusPill tone={problem.level === 'error' ? 'danger' : 'warning'}>
            {problem.level === 'error' ? 'Ошибка' : 'Совет'}
          </StatusPill>
          {problem.line !== undefined ? (
            <Button variant="ghost" size="small" onClick={() => onJump(problem.line ?? 1)}>
              Строка {problem.line}
            </Button>
          ) : null}
          <span>{problem.message}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Предпросмотр главной (черновик) с опубликованными своими блоками. «Выполнять скрипты» — та же
 * страница в изолированной рамке со скриптом сайта из формы и скриптами своих блоков страницы
 */
function ScriptPreview({ siteId, script }: { siteId: string; script: string }) {
  const [device, setDevice] = useState<Device>(initialDevice)
  const [run, setRun] = useState(false)
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const main = useQuery(pageQuery(siteId, MAIN_PAGE_SLUG))
  const library = useQuery(mediaQuery(siteId))
  const media = useMemo(() => mediaMapOf(library.data?.items ?? []), [library.data])
  const customBlocks = useCustomBlockMap(siteId)
  const draft = main.data?.draft
  const content = useMemo(
    () => (draft === undefined || draft.blocks.length === 0 ? PageContent.parse(demoPage) : draft),
    [draft],
  )
  const scripts = useMemo(() => {
    const list = script.trim() === '' ? [] : [{ label: 'сайт', file: siteScriptFile(script) }]
    for (const key of customBlockKeysOf(content)) {
      const block = customBlocks[key]
      if (block?.script?.trim()) {
        list.push({ label: key, file: customBlockScriptFile(key, block.script) })
      }
    }
    return list
  }, [script, content, customBlocks])
  return (
    <section aria-label="Предпросмотр главной" className={styles.preview}>
      <div className={styles.previewBar}>
        <p className={styles.note}>Главная страница (черновик)</p>
        <DeviceSwitch value={device} onChange={setDevice} />
      </div>
      <Checkbox
        label="Выполнять скрипты"
        hint="Страница в изолированной рамке: скриптам недоступны вход в админку и её данные, формы не отправляются, рамку на чужой адрес браузер не пускает. Скрипт в рамке может передать введённое в ней наружу (WebRTC, CSP это не закрывает): не вводите в предпросмотре пароли и личные данные, черновик от ИИ сначала прочитайте. Шрифты темы там могут замениться системными"
        checked={run}
        onChange={(event) => setRun(event.currentTarget.checked)}
      />
      <div className={styles.frame}>
        {run ? (
          <SandboxPreview
            title="Главная со скриптами"
            content={content}
            theme={site.theme}
            media={media}
            device={device}
            customBlocks={customBlocks}
            scripts={scripts}
          />
        ) : (
          <Preview
            title="Предпросмотр главной"
            content={content}
            theme={site.theme}
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
