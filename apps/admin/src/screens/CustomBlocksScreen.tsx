import {
  BLOCK_CATEGORIES,
  type CustomBlockDraftInput,
  customBlockType,
  NewCustomBlock,
} from '@averra/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useRef, useState } from 'react'
import { api } from '../api'
import {
  blockStatus,
  type ConflictChoice,
  importConflicts,
  readBlocksFile,
  resolutionsOf,
  suggestKey,
} from '../custom-blocks/custom-block-format'
import { saveResponse } from '../download'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { relativeTime } from '../format/time'
import { issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { canDefineBlocks } from '../permissions'
import { customBlocksQuery, queryKeys, siteQuery } from '../queries'
import { Button } from '../ui/Button'
import { DataTable } from '../ui/DataTable'
import { Dialog } from '../ui/Dialog'
import { EmptyState } from '../ui/EmptyState'
import { TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { FormActions, formClassName, monoClassName, Screen, Section } from '../ui/Screen'
import { SegmentedControl } from '../ui/SegmentedControl'
import { StatusPill } from '../ui/StatusPill'
import { usePageTitle } from '../ui/use-page-title'
import { useSiteId } from '../use-site'
import styles from './CustomBlocksScreen.module.scss'

type Notice = { tone: 'success' | 'danger'; text: string }

/**
 * Свои блоки сайта: список, создание, выгрузка в файл и загрузка из файла. Встроенные блоки и
 * темы — пресеты, свои — поля, шаблон и CSS под задачу клиента (как ACF Pro в WordPress)
 */
export function CustomBlocksScreen() {
  const siteId = useSiteId()
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { data } = useSuspenseQuery(customBlocksQuery(siteId))
  usePageTitle('Свои блоки', site.name)
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const [incoming, setIncoming] = useState<CustomBlockDraftInput[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const editable = canDefineBlocks(site.access)
  const keys = new Set(data.blocks.map((block) => block.key))

  const exportAll = useMutation({
    mutationFn: async () => {
      const res = await api.sites[':siteId']['custom-blocks'].export.$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      await saveResponse(res, 'custom-blocks.json')
    },
    onError: (error) =>
      setNotice({ tone: 'danger', text: `Не удалось выгрузить: ${messageOf(error)}` }),
  })

  async function pickFile(file: File | undefined) {
    if (!file) return
    setNotice(undefined)
    const result = readBlocksFile(await file.text())
    if (!result.ok) {
      setNotice({ tone: 'danger', text: result.message })
      return
    }
    setIncoming(result.blocks)
  }

  const imported = async (summary: string) => {
    setIncoming(null)
    setNotice({ tone: 'success', text: summary })
    await queryClient.invalidateQueries({ queryKey: queryKeys.customBlocks(siteId) })
  }

  return (
    <Screen>
      <PageHeader
        eyebrow={site.name}
        title="Свои блоки"
        meta="Поля, шаблон и CSS — блоки под этот сайт рядом со встроенными"
        actions={
          editable && (
            <>
              <Button icon="upload" onClick={() => fileRef.current?.click()}>
                Загрузить из файла
              </Button>
              <Button
                icon="download"
                loading={exportAll.isPending}
                aria-disabled={data.blocks.length === 0 ? true : undefined}
                onClick={() => {
                  if (data.blocks.length > 0) exportAll.mutate()
                }}
              >
                Выгрузить все
              </Button>
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                Создать блок
              </Button>
            </>
          )
        }
      />
      {/* Выбор файла — по кнопке «Загрузить из файла»: само поле скрыто, подпись у кнопки */}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void pickFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      {notice && (
        <InlineAlert tone={notice.tone} live>
          {notice.text}
        </InlineAlert>
      )}
      {!editable && (
        <InlineAlert tone="info">
          Свои блоки создаёт владелец установки. Опубликованные блоки есть в «Добавить блок» в
          редакторе страницы, в разделе «Свои».
        </InlineAlert>
      )}
      <Section
        title="Блоки сайта"
        description="Опубликованный блок появляется в редакторе страниц, в разделе «Свои» каталога"
      >
        {data.blocks.length === 0 ? (
          <EmptyState
            title="Своих блоков пока нет"
            icon="blocks"
            headingLevel={3}
            action={
              editable && (
                <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                  Создать блок
                </Button>
              )
            }
          >
            Свой блок — это поля для редактора, шаблон Liquid и CSS. Сайт не пересобирается из кода:
            блок живёт в базе этой установки, обновление Averra его не трогает.
          </EmptyState>
        ) : (
          <DataTable
            caption="Свои блоки"
            rows={data.blocks}
            rowKey={(block) => block.key}
            columns={[
              {
                key: 'title',
                header: 'Название',
                cell: (block) => {
                  const title = block.draft?.title ?? block.published?.title ?? block.key
                  return editable ? (
                    <Link to="/blocks/$key" params={{ key: block.key }}>
                      {title}
                    </Link>
                  ) : (
                    title
                  )
                },
              },
              {
                key: 'type',
                header: 'Тип на странице',
                mono: true,
                cell: (block) => customBlockType(block.key),
              },
              {
                key: 'category',
                header: 'Раздел',
                cell: (block) => {
                  const category = (block.draft ?? block.published)?.category
                  return category ? BLOCK_CATEGORIES[category] : '—'
                },
              },
              {
                key: 'status',
                header: 'Состояние',
                cell: (block) => {
                  const status = blockStatus({
                    published: block.published !== null,
                    unpublished: block.unpublished,
                  })
                  return <StatusPill tone={status.tone}>{status.text}</StatusPill>
                },
              },
              {
                key: 'updated',
                header: 'Изменён',
                muted: true,
                cell: (block) => relativeTime(block.updatedAt),
              },
            ]}
          />
        )}
      </Section>
      {editable && (
        <CreateDialog open={creating} onClose={() => setCreating(false)} siteId={siteId} />
      )}
      {incoming && (
        <ImportDialog
          siteId={siteId}
          blocks={incoming}
          existing={keys}
          onClose={() => setIncoming(null)}
          onDone={imported}
        />
      )}
    </Screen>
  )
}

/** Новый блок: название и ключ. Ключ предлагается из названия, пока его не правили руками */
function CreateDialog({
  open,
  onClose,
  siteId,
}: {
  open: boolean
  onClose: () => void
  siteId: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [key, setKey] = useState('')
  const [keyEdited, setKeyEdited] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string | undefined>>({})
  const [error, setError] = useState<string>()
  const shownKey = keyEdited ? key : suggestKey(title)
  const parsed = NewCustomBlock.safeParse({ key: shownKey, title })
  const errors = { ...(attempted ? zodFieldErrors(parsed.error) : {}), ...serverErrors }

  const create = useMutation({
    mutationFn: async (body: { key: string; title: string }) => {
      const res = await api.sites[':siteId']['custom-blocks'].$post({
        param: { siteId },
        json: body,
      })
      if (res.status !== 201) throw await apiRequestError(res)
      return res.json()
    },
  })

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setAttempted(true)
    setError(undefined)
    if (!parsed.success) return
    try {
      await create.mutateAsync(parsed.data)
      await queryClient.invalidateQueries({ queryKey: queryKeys.customBlocks(siteId) })
      onClose()
      await navigate({ to: '/blocks/$key', params: { key: parsed.data.key } })
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.issues.length > 0) {
        setServerErrors(issueFieldErrors(failure.issues))
      }
      setError(messageOf(failure))
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Новый свой блок"
      description="Блок начнётся с заголовка и текста — поля, шаблон и CSS поменяете дальше."
    >
      <form className={formClassName} onSubmit={onSubmit} noValidate>
        <TextInput
          label="Название"
          hint="Его видят редактор и клиент в каталоге блоков"
          value={title}
          maxChars={60}
          error={errors.title}
          onChange={(event) => {
            setTitle(event.target.value)
            setServerErrors({})
          }}
        />
        <TextInput
          label="Ключ"
          hint="Латиница, цифры и дефис. На странице блок — custom:<ключ>. После создания не меняется"
          mono
          prefix="custom:"
          value={shownKey}
          error={errors.key}
          onChange={(event) => {
            setKey(event.target.value)
            setKeyEdited(true)
            setServerErrors({})
          }}
        />
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <FormActions>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Создать
          </Button>
          <Button onClick={onClose}>Отмена</Button>
        </FormActions>
      </form>
    </Dialog>
  )
}

const CHOICES = [
  { value: 'rename', label: 'Переименовать' },
  { value: 'replace', label: 'Заменить черновик' },
  { value: 'skip', label: 'Пропустить' },
] as const

/**
 * Загрузка блоков из файла. Ключи, которые уже есть на установке, — на выбор: переименовать
 * (новое имя предложено), заменить черновик существующего (опубликованное не меняется) или
 * пропустить. Загруженное — черновики: на сайт они попадут после публикации
 */
function ImportDialog({
  siteId,
  blocks,
  existing,
  onClose,
  onDone,
}: {
  siteId: string
  blocks: readonly CustomBlockDraftInput[]
  existing: ReadonlySet<string>
  onClose: () => void
  onDone: (summary: string) => Promise<void>
}) {
  const [choices, setChoices] = useState(() => importConflicts(blocks, existing))
  const [error, setError] = useState<string>()
  const conflicts = Object.entries(choices)

  const upload = useMutation({
    mutationFn: async () => {
      const res = await api.sites[':siteId']['custom-blocks'].import.$post({
        param: { siteId },
        json: { blocks: [...blocks], resolutions: resolutionsOf(choices) },
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(undefined)
    try {
      const result = await upload.mutateAsync()
      const parts = [
        result.created.length > 0 && `новых: ${result.created.join(', ')}`,
        result.replaced.length > 0 && `заменён черновик: ${result.replaced.join(', ')}`,
        result.skipped.length > 0 && `пропущены: ${result.skipped.join(', ')}`,
      ].filter(Boolean)
      await onDone(`Блоки загружены черновиками (${parts.join('; ')}). Проверьте и опубликуйте их`)
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  const change = (key: string, choice: Partial<ConflictChoice>) =>
    setChoices((current) => ({
      ...current,
      [key]: { ...(current[key] as ConflictChoice), ...choice },
    }))

  return (
    <Dialog
      open
      onClose={onClose}
      title="Загрузить свои блоки"
      description={`В файле блоков: ${blocks.length} — ${blocks.map((block) => block.title).join(', ')}.`}
    >
      <form className={formClassName} onSubmit={onSubmit} noValidate>
        {conflicts.length === 0 ? (
          <p className={styles.note}>
            Таких ключей на установке нет: блоки встанут новыми черновиками.
          </p>
        ) : (
          conflicts.map(([key, choice]) => (
            <fieldset key={key} className={styles.conflict}>
              <legend className={styles.conflictTitle}>
                Ключ <span className={monoClassName}>{key}</span> уже занят
              </legend>
              <SegmentedControl
                legend={`Что сделать с блоком ${key}`}
                hideLegend
                name={`conflict-${key}`}
                options={CHOICES.map((option) => ({ value: option.value, label: option.label }))}
                value={choice.action}
                onChange={(action) => change(key, { action })}
              />
              {choice.action === 'rename' && (
                <TextInput
                  label="Новый ключ"
                  mono
                  prefix="custom:"
                  value={choice.rename}
                  onChange={(event) => change(key, { rename: event.target.value })}
                />
              )}
            </fieldset>
          ))
        )}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <FormActions>
          <Button type="submit" variant="primary" loading={upload.isPending}>
            Загрузить
          </Button>
          <Button onClick={onClose}>Отмена</Button>
        </FormActions>
      </form>
    </Dialog>
  )
}
