import {
  type BlockType,
  type PageContent,
  type PageSeo,
  PageTitle,
  pageSeoChecks,
  type SiteSeo,
  seoAdvice,
  type Theme,
} from '@averra/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBlocker } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { apiErrorText, apiRequestError, messageOf } from '../errors'
import type { FieldProps, Widgets } from '../forms/SchemaForm'
import { ImageField } from '../media/ImageField'
import { mediaMapOf } from '../media/media-format'
import { pagePath } from '../pages-format'
import { canPublish, type SiteAccess } from '../permissions'
import { mediaQuery, queryKeys, revisionQuery } from '../queries'
import {
  adviceText,
  checkPageSeo,
  normalizedSeo,
  type SeoField,
  seoFieldLabels,
} from '../seo/page-seo-format'
import { Button, IconButton, iconButtonClassName } from '../ui/Button'
import { CountBadge } from '../ui/CountBadge'
import { Icon } from '../ui/Icon'
import { InlineAlert } from '../ui/InlineAlert'
import { StatusPill, type StatusTone } from '../ui/StatusPill'
import { moveItem } from '../ui/sortable'
import { TabList } from '../ui/Tabs'
import { COMPACT_SCREEN, NARROW_SCREEN, useMediaQuery } from '../ui/use-media-query'
import { usePageTitle } from '../ui/use-page-title'
import { AddBlockDialog } from './AddBlockDialog'
import { BlockList } from './BlockList'
import { blockName } from './block-hint'
import { createBlock, type EditorBlock, insertBlock, removeBlock, updateBlockProps } from './draft'
import { draftState, type ServerPage } from './draft-state'
import styles from './Editor.module.scss'
import { History, type HistoryRevision } from './History'
import { restoredMessage, restoreQuestion, revisionLabel, revisionPreview } from './history-format'
import { Inspector } from './Inspector'
import { type Device, DeviceSwitch, initialDevice, Preview } from './Preview'
import { SeoPanel } from './SeoPanel'
import { validateBlocks } from './validation'

export type EditorSite = {
  id: string
  name: string
  theme: Theme
  access: SiteAccess
  /** SEO сайта для панели «SEO» страницы: шаблон заголовка, описание, картинка, адрес */
  seo: SiteSeo
}
export type EditorPage = {
  slug: string
  title: string
  draft: PageContent
  publishedTitle: string | null
  published: unknown
  publishedAt: string | null
}

type Status = { kind: 'idle' | 'busy' | 'done' | 'error'; message?: string }

/** Колонка редактора; на узком экране — вкладка */
type Column = 'blocks' | 'preview' | 'fields'

/** Скрыть шапку и подвал сайта на этой странице (флажки в панели «SEO») */
type Chrome = { hideHeader: boolean; hideFooter: boolean }

const chromeOf = (content: {
  hideHeader?: boolean | undefined
  hideFooter?: boolean | undefined
}) => ({
  hideHeader: content.hideHeader === true,
  hideFooter: content.hideFooter === true,
})

const snapshotOf = (title: string, blocks: readonly EditorBlock[], seo: PageSeo, chrome: Chrome) =>
  JSON.stringify({ title, blocks, seo: normalizedSeo(seo) ?? null, ...chrome })

/** Что из ответа API нужно плашке состояния: черновик и опубликованная версия */
const serverPageOf = (page: EditorPage | ServerPage): ServerPage => ({
  title: page.title,
  draft: page.draft,
  publishedTitle: page.publishedTitle,
  published: page.published,
  publishedAt: page.publishedAt,
})

export function Editor({ site, page }: { site: EditorSite; page: EditorPage }) {
  const [title, setTitle] = useState(page.title)
  const [blocks, setBlocks] = useState<readonly EditorBlock[]>(page.draft.blocks)
  // SEO страницы (панель «SEO»): заголовок, описание, картинка, canonical, noindex — в черновике
  const [seo, setSeo] = useState<PageSeo>(page.draft.seo ?? {})
  // Скрыть шапку и подвал сайта на этой странице (промо) — тоже часть черновика, флажки в панели
  // «SEO»
  const [chrome, setChrome] = useState<Chrome>(() => chromeOf(page.draft))
  const [selectedId, setSelectedId] = useState(page.draft.blocks[0]?.id ?? null)
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    snapshotOf(page.title, page.draft.blocks, page.draft.seo ?? {}, chromeOf(page.draft)),
  )
  // Страница, какой её последний раз отдал API: по ней плашка говорит, опубликовано ли
  const [server, setServer] = useState<ServerPage>(() => serverPageOf(page))
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  // Какая кнопка запустила идущее действие: она крутит спиннер и остаётся в фокусе
  const [pending, setPending] = useState<'save' | 'publish' | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  // Панель «SEO» в колонке полей — вместо полей блока, как история
  const [seoOpen, setSeoOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [device, setDevice] = useState<Device>(initialDevice)
  // Версия из истории в предпросмотре. Черновик в редакторе она не трогает
  const [shownRevision, setShownRevision] = useState<HistoryRevision | null>(null)
  const ids = useId()
  const historyId = `${ids}-history`
  const seoPanelId = `${ids}-seo`
  const titleErrorId = `${ids}-title-error`
  usePageTitle(title.trim() || pagePath(page.slug), 'редактор')

  // Узкий экран: колонки — вкладки. Роли вкладок нужны только там, где вкладки есть
  const narrow = useMediaQuery(NARROW_SCREEN)
  // Узкий экран — всегда и средний
  const compact = useMediaQuery(COMPACT_SCREEN) || narrow
  const [tab, setTab] = useState<Column>('blocks')
  const tabId = (column: Column) => `${ids}-tab-${column}`
  const panelId = (column: Column) => `${ids}-panel-${column}`
  // Выбор блока на узком экране открывает «Поля», а кнопка выбора прячется вместе со списком:
  // фокус переводим на вкладку «Поля», а не теряем
  const focusFieldsTab = useRef(false)
  useEffect(() => {
    if (!focusFieldsTab.current) return
    focusFieldsTab.current = false
    document.getElementById(tabId('fields'))?.focus()
  })

  // Поля другого блока (или история) начинаются сверху, а не там, где прокрутили прошлые
  const fieldsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    fieldsRef.current?.scrollTo?.({ top: 0 })
  }, [selectedId, historyOpen, seoOpen])

  // Медиатека сайта: из неё поле «картинка» выбирает, а предпросмотр берёт адреса вариантов
  const library = useQuery(mediaQuery(site.id))
  const media = useMemo(() => mediaMapOf(library.data?.items ?? []), [library.data])
  const widgets = useMemo<Widgets>(
    () => ({ image: (props: FieldProps) => <ImageField {...props} siteId={site.id} /> }),
    [site.id],
  )

  const validation = useMemo(() => validateBlocks(blocks), [blocks])
  const invalidIds = useMemo(() => new Set(Object.keys(validation.blockErrors)), [validation])

  // Пока в форме ошибка, предпросмотр показывает последнюю правильную версию страницы
  const [previewContent, setPreviewContent] = useState(page.draft)
  useEffect(() => {
    if (validation.content) setPreviewContent(validation.content)
  }, [validation.content])

  const dirty = snapshotOf(title, blocks, seo, chrome) !== savedSnapshot
  // SEO страницы — по той же схеме, что у API: кривой canonical или длинное описание не сохранить
  const seoResult = checkPageSeo(seo)
  const seoErrorField = Object.keys(seoResult.errors)[0] as SeoField | undefined
  const seoError = seoErrorField && seoResult.errors[seoErrorField]
  const content: PageContent | null = validation.content
    ? {
        ...validation.content,
        ...(seoResult.seo ? { seo: seoResult.seo } : {}),
        ...(chrome.hideHeader ? { hideHeader: true } : {}),
        ...(chrome.hideFooter ? { hideFooter: true } : {}),
      }
    : null
  // Советы SEO по черновику как есть: видны на кнопке «SEO» до публикации и публиковать не мешают
  const seoChecks = useMemo(
    () =>
      pageSeoChecks(
        { slug: page.slug, title: title.trim(), blocks, seo: normalizedSeo(seo) },
        site.seo,
      ),
    [page.slug, title, blocks, seo, site.seo],
  )
  const advice = seoAdvice(seoChecks)
  const adviceBadge =
    advice.length > 0 ? (
      <CountBadge
        count={advice.length}
        tone={advice.some((check) => check.level === 'problem') ? 'danger' : 'warning'}
      />
    ) : undefined
  const adviceWords =
    advice.length > 0 ? (
      <span className="visually-hidden">: {adviceText(advice.length)}</span>
    ) : undefined
  const seoLabel = advice.length > 0 ? `SEO: ${adviceText(advice.length)}` : 'SEO'
  // Та же схема, что у API: те же правила (пробелы — тоже пусто, не больше 120 символов).
  // Сообщение совпадёт с ответом сервера, пока и тут и там включён setupZodMessages
  const titleError = PageTitle.safeParse(title).error?.issues[0]?.message
  const titleValid = titleError === undefined
  const canSave = content !== null && titleValid && seoError === undefined
  const busy = status.kind === 'busy'
  const canSaveNow = dirty && canSave && !busy
  const canPublishNow = canSave && !busy

  // Новая правка после «Сохранено» снова делает статус «есть изменения»
  useEffect(() => {
    if (dirty) setStatus((current) => (current.kind === 'done' ? { kind: 'idle' } : current))
  }, [dirty])

  // Не даём случайно закрыть вкладку с несохранёнными правками
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // И уйти по ссылке внутри админки («Назад к сайту») или кнопкой «Назад» браузера. Закрытие
  // вкладки ловит beforeunload выше, а свой у блокировщика по умолчанию включён всегда,
  // даже без правок
  useBlocker({
    shouldBlockFn: () =>
      !window.confirm('На странице есть несохранённые изменения. Уйти без сохранения?'),
    disabled: !dirty,
    enableBeforeUnload: false,
  })

  const pageApi = api.sites[':siteId'].pages[':slug']
  const param = { siteId: site.id, slug: page.slug }
  const queryClient = useQueryClient()
  // Список страниц показывает, есть ли неопубликованные правки, и когда опубликовано:
  // после сохранения и публикации он устарел. Сброс по префиксу задевает и эту страницу
  const refreshPages = () => queryClient.invalidateQueries({ queryKey: queryKeys.pages(site.id) })

  const saveDraft = useMutation({
    mutationFn: async (body: { title: string; content: PageContent }) => {
      const res = await pageApi.$put({ param, json: body })
      if (res.status !== 200) throw new Error(await apiErrorText(res))
      return res.json()
    },
    onSuccess: refreshPages,
  })

  const restoreRevision = useMutation({
    mutationFn: async (revisionId: string) => {
      const res = await pageApi.revisions[':revisionId'].restore.$post({
        param: { ...param, revisionId },
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: refreshPages,
  })

  const shown = useQuery({
    ...revisionQuery(site.id, page.slug, shownRevision?.id ?? ''),
    enabled: shownRevision !== null,
  })
  // Снимок проверяем нынешними схемами: старую несовместимую версию блоки не нарисуют
  const shownPreview = useMemo(
    () => (shown.data && shownRevision ? revisionPreview(shown.data.content) : undefined),
    [shown.data, shownRevision],
  )

  const publishDraft = useMutation({
    mutationFn: async () => {
      const res = await pageApi.publish.$post({ param })
      if (res.status !== 200) throw new Error(await apiErrorText(res))
      return res.json()
    },
    // Публикация заводит сборку сайта на сервере: её состояние на обзоре и в «Настройках сайта»
    // тоже устарело
    onSuccess: () =>
      Promise.all([
        refreshPages(),
        queryClient.invalidateQueries({ queryKey: queryKeys.build(site.id) }),
      ]),
  })

  async function save() {
    if (!content || !titleValid || seoError !== undefined) return false
    setStatus({ kind: 'busy', message: 'Сохраняю…' })
    try {
      const saved = await saveDraft.mutateAsync({ title, content })
      setSavedSnapshot(snapshotOf(title, blocks, seo, chrome))
      setServer(serverPageOf(saved))
      // Итог сохранения — сама плашка: «Сохранено · правки не опубликованы» и подобное
      setStatus({ kind: 'idle' })
      return true
    } catch (error) {
      setStatus({ kind: 'error', message: messageOf(error) })
      return false
    }
  }

  async function saveNow() {
    setPending('save')
    await save()
    setPending(null)
  }

  async function publish() {
    setPending('publish')
    try {
      if (dirty && !(await save())) return
      setStatus({ kind: 'busy', message: 'Публикую…' })
      setServer(serverPageOf(await publishDraft.mutateAsync()))
      setStatus({ kind: 'done', message: 'Опубликовано. Обнови сайт, чтобы увидеть' })
    } catch (error) {
      setStatus({ kind: 'error', message: messageOf(error) })
    } finally {
      setPending(null)
    }
  }

  async function restore(revision: HistoryRevision) {
    if (dirty && !window.confirm(restoreQuestion(revision))) return
    setStatus({ kind: 'busy', message: 'Возвращаю версию…' })
    try {
      const restored = await restoreRevision.mutateAsync(revision.id)
      // Редактор берёт черновик из ответа API, как при открытии страницы
      setTitle(restored.title)
      setBlocks(restored.draft.blocks)
      setSeo(restored.draft.seo ?? {})
      setChrome(chromeOf(restored.draft))
      setSavedSnapshot(
        snapshotOf(
          restored.title,
          restored.draft.blocks,
          restored.draft.seo ?? {},
          chromeOf(restored.draft),
        ),
      )
      setServer(serverPageOf(restored))
      setSelectedId(restored.draft.blocks[0]?.id ?? null)
      setPreviewContent(restored.draft)
      setShownRevision(null)
      setStatus({ kind: 'done', message: restoredMessage(revision, canPublish(site.access)) })
    } catch (error) {
      setStatus({ kind: 'error', message: messageOf(error) })
    }
  }

  function toggleHistory() {
    setHistoryOpen(!historyOpen)
    setSeoOpen(false)
    setShownRevision(null)
    // На узком экране история — во вкладке полей: открыли — показываем её
    if (!historyOpen) setTab('fields')
  }

  function toggleSeo() {
    setSeoOpen(!seoOpen)
    setHistoryOpen(false)
    setShownRevision(null)
    if (!seoOpen) setTab('fields')
  }

  // Правят всё равно черновик: выбор блока возвращает к его полям и к его предпросмотру.
  // reveal — выбор из списка или после добавления: на узком экране открываются «Поля»
  const selectBlock = useCallback(
    (id: string, reveal = false) => {
      setSelectedId(id)
      setHistoryOpen(false)
      setSeoOpen(false)
      setShownRevision(null)
      if (reveal && narrow) {
        setTab('fields')
        focusFieldsTab.current = true
      }
    },
    [narrow],
  )

  // Правка блоков меняет черновик: предпросмотр возвращается к нему, иначе показанная версия
  // осталась бы с подписью «Черновик не изменился», хотя он уже изменился
  const editBlocks = (next: readonly EditorBlock[]) => {
    setBlocks(next)
    setShownRevision(null)
  }

  const addBlock = (type: BlockType) => {
    const block = createBlock(type, blocks)
    editBlocks(insertBlock(blocks, block, selectedId ?? undefined))
    setAdding(false)
    selectBlock(block.id, true)
  }

  const deleteBlock = (id: string) => {
    editBlocks(removeBlock(blocks, id))
    if (id === selectedId) setSelectedId(null)
  }

  const selected = blocks.find((block) => block.id === selectedId)
  const state = draftState(dirty, server)
  const pill: { label: string; tone: StatusTone } =
    status.kind === 'busy' && status.message
      ? { label: status.message, tone: 'info' }
      : status.kind === 'done' && status.message
        ? { label: status.message, tone: 'success' }
        : state

  const showingRevision = shownRevision !== null
  const previewSelect = useCallback((id: string) => selectBlock(id), [selectBlock])
  const deviceSwitch = <DeviceSwitch value={device} onChange={setDevice} />

  // Колонка: на широком экране — просто колонка, на узком — панель своей вкладки
  const columnProps = (column: Column) =>
    narrow
      ? {
          role: 'tabpanel',
          id: panelId(column),
          'aria-labelledby': tabId(column),
          hidden: tab !== column,
        }
      : {}

  return (
    <div className={styles.editor}>
      <header className={styles.topbar}>
        {/* Именованная область: ориентир для диктора и место, где e2e ищет статус редактора.
            Живые области role="status" есть ещё у каждого списка с перетаскиванием */}
        <section className={styles.page} aria-label="Страница">
          <Link
            to="/"
            className={iconButtonClassName({ variant: 'secondary' })}
            aria-label="Назад к сайту"
            title="Назад к сайту"
          >
            <Icon name="chevron-left" />
          </Link>
          <div className={styles.titles}>
            <h1 className="visually-hidden">Редактор страницы {pagePath(page.slug)}</h1>
            <span className={styles.siteName}>{site.name}</span>
            <div className={styles.titleRow}>
              <label className="visually-hidden" htmlFor={`${ids}-title`}>
                Заголовок страницы
              </label>
              {/* Поле выглядит как текст, как в концепте. Что его можно править, подсказывают
                  карандаш рядом и подсказка при наведении */}
              <span className={styles.titleField}>
                <input
                  id={`${ids}-title`}
                  className={styles.titleInput}
                  value={title}
                  autoComplete="off"
                  title="Заголовок страницы — нажмите, чтобы изменить"
                  onChange={(event) => setTitle(event.target.value)}
                  aria-invalid={titleValid ? undefined : true}
                  aria-describedby={titleValid ? undefined : titleErrorId}
                />
                <Icon name="edit" size={14} className={styles.titleEdit} />
              </span>
              <span role="status" className={styles.status}>
                {/* На узком экране — точкой и текстом, без плашки: встаёт в строку заголовка */}
                <StatusPill tone={pill.tone} appearance={narrow ? 'dot' : 'pill'}>
                  {pill.label}
                </StatusPill>
              </span>
            </div>
          </div>
        </section>

        {!narrow && <div className={styles.devices}>{deviceSwitch}</div>}

        <div className={styles.actions}>
          {/* На узком экране в полосе места нет: «SEO» — под списком блоков. На среднем —
              иконкой, как «История»: с подписями кнопки не встают в одну строку. Число советов —
              значком, а словами — в подписи для диктора */}
          {!narrow &&
            (compact ? (
              <IconButton
                label={seoLabel}
                icon="search"
                variant="secondary"
                badge={adviceBadge}
                aria-expanded={seoOpen}
                aria-controls={seoOpen ? seoPanelId : undefined}
                onClick={toggleSeo}
              />
            ) : (
              <Button
                icon="search"
                aria-expanded={seoOpen}
                aria-controls={seoOpen ? seoPanelId : undefined}
                onClick={toggleSeo}
              >
                SEO
                {adviceBadge}
                {adviceWords}
              </Button>
            ))}
          {/* На узком и среднем экране — только иконка: на узком полоса и так в две строки, а у
              иконки подпись для диктора и подсказка та же */}
          {compact ? (
            <IconButton
              label="История"
              icon="history"
              variant="secondary"
              size={narrow ? 'small' : 'medium'}
              aria-expanded={historyOpen}
              aria-controls={historyOpen ? historyId : undefined}
              onClick={toggleHistory}
            />
          ) : (
            <Button
              icon="history"
              aria-expanded={historyOpen}
              aria-controls={historyOpen ? historyId : undefined}
              onClick={toggleHistory}
            >
              История
            </Button>
          )}
          {/* Недоступность — aria-disabled, а не disabled: после сохранения кнопка остаётся
              в фокусе, и следующий Tab идёт дальше по полосе, а не с начала страницы */}
          <Button
            size={narrow ? 'small' : 'medium'}
            loading={pending === 'save'}
            aria-disabled={canSaveNow || pending === 'save' ? undefined : true}
            onClick={() => {
              if (canSaveNow) void saveNow()
            }}
          >
            Сохранить
          </Button>
          {/* Клиент публиковать не может: API ответит 403, кнопка только сбивала бы с толку */}
          {canPublish(site.access) && (
            <Button
              variant="primary"
              size={narrow ? 'small' : 'medium'}
              loading={pending === 'publish'}
              aria-disabled={canPublishNow || pending === 'publish' ? undefined : true}
              onClick={() => {
                if (canPublishNow) void publish()
              }}
            >
              Опубликовать
            </Button>
          )}
        </div>
      </header>

      {(titleError !== undefined ||
        seoError !== undefined ||
        validation.pageErrors.length > 0 ||
        status.kind === 'error') && (
        <div className={styles.alerts}>
          {titleError !== undefined && (
            <p id={titleErrorId} className={styles.pageError}>
              Заголовок страницы: {titleError}
            </p>
          )}
          {seoErrorField && seoError !== undefined && (
            <p className={styles.pageError}>
              SEO страницы, {seoFieldLabels[seoErrorField].toLowerCase()}: {seoError}
            </p>
          )}
          {validation.pageErrors.length > 0 && (
            <p className={styles.pageError}>{validation.pageErrors.join('. ')}</p>
          )}
          {status.kind === 'error' && (
            <InlineAlert tone="danger" title="Не получилось">
              {status.message}
            </InlineAlert>
          )}
        </div>
      )}

      <main className={styles.workspace}>
        {narrow && (
          <div className={styles.tabs}>
            <TabList
              label="Части редактора"
              items={[
                { id: 'blocks', label: 'Блоки' },
                { id: 'preview', label: 'Предпросмотр' },
                {
                  id: 'fields',
                  label: historyOpen ? 'История' : seoOpen ? 'SEO' : 'Поля',
                },
              ]}
              value={tab}
              onChange={setTab}
              tabId={tabId}
              panelId={panelId}
            />
          </div>
        )}

        <div className={styles.blocks} {...columnProps('blocks')}>
          <BlockList
            blocks={blocks}
            selectedId={selectedId}
            invalidIds={invalidIds}
            onSelect={(id) => selectBlock(id, true)}
            onMove={(from, to) => editBlocks(moveItem(blocks, from, to))}
            onRemove={deleteBlock}
            onAdd={() => setAdding(true)}
            actionsOnEvery={narrow}
            footer={
              narrow && (
                <Button
                  icon="search"
                  aria-expanded={seoOpen}
                  aria-controls={seoOpen ? seoPanelId : undefined}
                  onClick={toggleSeo}
                >
                  SEO страницы
                  {adviceBadge}
                  {adviceWords}
                </Button>
              )
            }
          />
        </div>

        <section className={styles.preview} aria-label="Предпросмотр" {...columnProps('preview')}>
          <Preview
            content={shownPreview?.content ?? previewContent}
            theme={site.theme}
            media={media}
            device={device}
            note={previewNote(shownRevision, shown, shownPreview?.error)}
            selectedId={showingRevision ? null : selectedId}
            onSelectBlock={showingRevision ? undefined : previewSelect}
            toolbar={narrow ? deviceSwitch : undefined}
          />
        </section>

        <div ref={fieldsRef} className={styles.fields} {...columnProps('fields')}>
          {historyOpen ? (
            <History
              id={historyId}
              siteId={site.id}
              slug={page.slug}
              selectedId={shownRevision?.id ?? null}
              restoring={busy}
              onSelect={setShownRevision}
              onRestore={restore}
            />
          ) : seoOpen ? (
            <SeoPanel
              id={seoPanelId}
              siteId={site.id}
              siteName={site.name}
              siteSeo={site.seo}
              slug={page.slug}
              pageTitle={title}
              seo={seo}
              errors={seoResult.errors}
              checks={seoChecks}
              library={library.data?.items}
              onChange={setSeo}
              hideHeader={chrome.hideHeader}
              onHideHeaderChange={(hideHeader) => setChrome({ ...chrome, hideHeader })}
              hideFooter={chrome.hideFooter}
              onHideFooterChange={(hideFooter) => setChrome({ ...chrome, hideFooter })}
            />
          ) : (
            <Inspector
              block={selected}
              errors={selected ? (validation.blockErrors[selected.id] ?? {}) : {}}
              onChange={(props) => {
                if (selected) setBlocks(updateBlockProps(blocks, selected.id, props))
              }}
              widgets={widgets}
            />
          )}
        </div>
      </main>

      <AddBlockDialog
        open={adding}
        onClose={() => setAdding(false)}
        onPick={addBlock}
        after={selected ? blockName(selected) : null}
      />
    </div>
  )
}

/** Подпись над предпросмотром, когда в нём не черновик, а версия из истории */
function previewNote(
  revision: HistoryRevision | null,
  query: { isPending: boolean; error: Error | null },
  incompatible?: string,
) {
  if (!revision) return undefined
  const label = revisionLabel(revision)
  if (query.error) return `${label}: не удалось загрузить — ${messageOf(query.error)}`
  if (incompatible) return `${label}: ${incompatible}. В предпросмотре черновик`
  if (query.isPending) return `${label}: загружаю…`
  return `${label} — так страница выглядела на сайте. Черновик не изменился`
}
