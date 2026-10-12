import { type BlockType, type PageContent, PageTitle, type Theme } from '@cms/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useBlocker } from '@tanstack/react-router'
import { useEffect, useId, useMemo, useState } from 'react'
import { api } from '../api'
import { apiErrorText, messageOf } from '../errors'
import { pagePath } from '../pages-format'
import { queryKeys } from '../queries'
import { Breadcrumbs } from '../ui/Breadcrumbs'
import { BlockList } from './BlockList'
import {
  createBlock,
  type EditorBlock,
  insertBlock,
  moveBlock,
  removeBlock,
  updateBlockProps,
} from './draft'
import styles from './Editor.module.css'
import { Inspector } from './Inspector'
import { Preview } from './Preview'
import { validateBlocks } from './validation'

export type EditorSite = { id: string; name: string; theme: Theme }
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

  const validation = useMemo(() => validateBlocks(blocks), [blocks])
  const invalidIds = useMemo(() => new Set(Object.keys(validation.blockErrors)), [validation])

  // Пока в форме ошибка, предпросмотр показывает последнюю правильную версию страницы
  const [previewContent, setPreviewContent] = useState(page.draft)
  useEffect(() => {
    if (validation.content) setPreviewContent(validation.content)
  }, [validation.content])

  const dirty = snapshotOf(title, blocks) !== savedSnapshot
  // Та же схема, что у API: сообщение об ошибке совпадёт с тем, что ответил бы сервер
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

  const addBlock = (type: BlockType) => {
    const block = createBlock(type, blocks)
    setBlocks(insertBlock(blocks, block, selectedId ?? undefined))
    setSelectedId(block.id)
  }

  const deleteBlock = (id: string) => {
    setBlocks(removeBlock(blocks, id))
    if (id === selectedId) setSelectedId(null)
  }

  const selected = blocks.find((block) => block.id === selectedId)

  return (
    <div className={styles.editor}>
      <div className={styles.top}>
        <header className={styles.topbar}>
          <Breadcrumbs site={site} page={pagePath(page.slug)} />
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
            className={styles.primary}
            onClick={publish}
            disabled={!canSave || busy}
          >
            Опубликовать
          </button>
        </header>
        {titleError !== undefined && (
          <p id={titleErrorId} className={styles.pageErrors}>
            Заголовок страницы: {titleError}
          </p>
        )}
        {validation.pageErrors.length > 0 && (
          <p className={styles.pageErrors}>{validation.pageErrors.join('. ')}</p>
        )}
      </div>

      <BlockList
        blocks={blocks}
        selectedId={selectedId}
        invalidIds={invalidIds}
        onSelect={setSelectedId}
        onMove={(id, offset) => setBlocks(moveBlock(blocks, id, offset))}
        onRemove={deleteBlock}
        onAdd={addBlock}
      />
      <Preview content={previewContent} theme={site.theme} />
      <Inspector
        block={selected}
        errors={selected ? (validation.blockErrors[selected.id] ?? {}) : {}}
        onChange={(props) => {
          if (selected) setBlocks(updateBlockProps(blocks, selected.id, props))
        }}
      />
    </div>
  )
}
