import { type BlockType, type PageContent, PageTitle, type Theme } from '@averra/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useBlocker } from '@tanstack/react-router'
import { useEffect, useId, useMemo, useState } from 'react'
import { api } from '../api'
import { apiErrorText, apiRequestError, messageOf } from '../errors'
import type { FieldProps, Widgets } from '../forms/SchemaForm'
import { ImageField } from '../media/ImageField'
import { mediaMapOf } from '../media/media-format'
import { pagePath } from '../pages-format'
import { canPublish, type SiteAccess } from '../permissions'
import { mediaQuery, queryKeys, revisionQuery } from '../queries'
import { Breadcrumbs } from '../ui/Breadcrumbs'
import { moveItem } from '../ui/sortable'
import { usePageTitle } from '../ui/use-page-title'
import { BlockList } from './BlockList'
import { createBlock, type EditorBlock, insertBlock, removeBlock, updateBlockProps } from './draft'
import styles from './Editor.module.css'
import { History, type HistoryRevision } from './History'
import { restoredMessage, restoreQuestion, revisionLabel, revisionPreview } from './history-format'
import { Inspector } from './Inspector'
import { Preview } from './Preview'
import { validateBlocks } from './validation'

export type EditorSite = { id: string; name: string; theme: Theme; access: SiteAccess }
export type EditorPage = { slug: string; title: string; draft: PageContent }

type Status = { kind: 'idle' | 'busy' | 'done' | 'error'; message?: string }

const snapshotOf = (title: string, blocks: readonly EditorBlock[]) =>
  JSON.stringify({ title, blocks })

export function Editor({ site, page }: { site: EditorSite; page: EditorPage }) {
  const [title, setTitle] = useState(page.title)
  const [blocks, setBlocks] = useState<readonly EditorBlock[]>(page.draft.blocks)
  const [selectedId, setSelectedId] = useState(page.draft.blocks[0]?.id ?? null)
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    snapshotOf(page.title, page.draft.blocks),
  )
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [historyOpen, setHistoryOpen] = useState(false)
  // Версия из истории в предпросмотре. Черновик в редакторе она не трогает
  const [shownRevision, setShownRevision] = useState<HistoryRevision | null>(null)
  const historyId = useId()
  usePageTitle(title.trim() || pagePath(page.slug), 'редактор')

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

  const dirty = snapshotOf(title, blocks) !== savedSnapshot
  // Та же схема, что у API: те же правила (пробелы — тоже пусто, не больше 120 символов).
  // Сообщение совпадёт с ответом сервера, пока и тут и там включён setupZodMessages
  const titleError = PageTitle.safeParse(title).error?.issues[0]?.message
  const titleValid = titleError === undefined
  const titleErrorId = useId()
  const canSave = validation.content !== null && titleValid
  const busy = status.kind === 'busy'

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

  // И уйти по ссылке внутри админки или кнопкой «Назад» браузера. Закрытие вкладки ловит
  // beforeunload выше, а свой у блокировщика по умолчанию включён всегда, даже без правок
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
    },
    onSuccess: refreshPages,
  })

  async function save() {
    if (!validation.content || !titleValid) return false
    setStatus({ kind: 'busy', message: 'Сохраняю…' })
    try {
      await saveDraft.mutateAsync({ title, content: validation.content })
      setSavedSnapshot(snapshotOf(title, blocks))
      setStatus({ kind: 'done', message: 'Черновик сохранён' })
      return true
    } catch (error) {
      setStatus({ kind: 'error', message: messageOf(error) })
      return false
    }
  }

  async function publish() {
    if (dirty && !(await save())) return
    setStatus({ kind: 'busy', message: 'Публикую…' })
    try {
      await publishDraft.mutateAsync()
      setStatus({ kind: 'done', message: 'Опубликовано. Обнови сайт, чтобы увидеть' })
    } catch (error) {
      setStatus({ kind: 'error', message: messageOf(error) })
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
      setSavedSnapshot(snapshotOf(restored.title, restored.draft.blocks))
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
    setShownRevision(null)
  }

  // Правят всё равно черновик: выбор блока возвращает к его полям и к его предпросмотру
  function selectBlock(id: string) {
    setSelectedId(id)
    setHistoryOpen(false)
    setShownRevision(null)
  }

  // Правка блоков меняет черновик: предпросмотр возвращается к нему, иначе показанная версия
  // осталась бы с подписью «Черновик не изменился», хотя он уже изменился
  const editBlocks = (next: readonly EditorBlock[]) => {
    setBlocks(next)
    setShownRevision(null)
  }

  const addBlock = (type: BlockType) => {
    const block = createBlock(type, blocks)
    editBlocks(insertBlock(blocks, block, selectedId ?? undefined))
    selectBlock(block.id)
  }

  const deleteBlock = (id: string) => {
    editBlocks(removeBlock(blocks, id))
    if (id === selectedId) setSelectedId(null)
  }

  const selected = blocks.find((block) => block.id === selectedId)

  return (
    <main className={styles.editor}>
      {/* Именованная область: ориентир для диктора и место, где e2e ищет статус редактора.
          Живые области role="status" есть ещё у каждого списка с перетаскиванием */}
      <section className={styles.top} aria-label="Страница">
        <header className={styles.topbar}>
          <Breadcrumbs site={site} current={pagePath(page.slug)} />
          <label className={styles.title}>
            <span className={styles.titleLabel}>Заголовок страницы</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={titleValid ? undefined : true}
              aria-describedby={titleValid ? undefined : titleErrorId}
            />
          </label>
          <span className={styles.status} data-kind={status.kind} role="status">
            {status.message ?? (dirty ? 'Есть несохранённые изменения' : 'Всё сохранено')}
          </span>
          <button type="button" onClick={save} disabled={!dirty || !canSave || busy}>
            Сохранить черновик
          </button>
          <button
            type="button"
            aria-expanded={historyOpen}
            aria-controls={historyOpen ? historyId : undefined}
            onClick={toggleHistory}
          >
            История
          </button>
          {/* Клиент публиковать не может: API ответит 403, кнопка только сбивала бы с толку */}
          {canPublish(site.access) && (
            <button
              type="button"
              className={styles.primary}
              onClick={publish}
              disabled={!canSave || busy}
            >
              Опубликовать
            </button>
          )}
        </header>
        {titleError !== undefined && (
          <p id={titleErrorId} className={styles.pageErrors}>
            Заголовок страницы: {titleError}
          </p>
        )}
        {validation.pageErrors.length > 0 && (
          <p className={styles.pageErrors}>{validation.pageErrors.join('. ')}</p>
        )}
      </section>

      <BlockList
        blocks={blocks}
        selectedId={selectedId}
        invalidIds={invalidIds}
        onSelect={selectBlock}
        onMove={(from, to) => editBlocks(moveItem(blocks, from, to))}
        onRemove={deleteBlock}
        onAdd={addBlock}
      />
      <Preview
        content={shownPreview?.content ?? previewContent}
        theme={site.theme}
        media={media}
        note={previewNote(shownRevision, shown, shownPreview?.error)}
      />
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
    </main>
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
