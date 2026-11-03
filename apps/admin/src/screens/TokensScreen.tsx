import { NewToken, type TokenRights } from '@averra/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { type FormEvent, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { relativeTime } from '../format/time'
import { firstInvalidField, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { formatDateTime } from '../pages-format'
import { queryKeys, tokensQuery } from '../queries'
import {
  DRAFTS_ONLY,
  isDraftsOnly,
  mcpConfigFragment,
  rightsSummary,
  type TokenState,
  tokenRightHints,
  tokenRightLabels,
  tokenRightOrder,
  tokenState,
  tokenStateLabels,
} from '../tokens/token-format'
import { Button } from '../ui/Button'
import { type Column, DataTable } from '../ui/DataTable'
import { Dialog } from '../ui/Dialog'
import { EmptyState } from '../ui/EmptyState'
import { Checkbox, TextArea, TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { FormActions, formClassName, mutedClassName, Screen, Section } from '../ui/Screen'
import { StatusPill, type StatusTone } from '../ui/StatusPill'
import { usePageTitle } from '../ui/use-page-title'
import styles from './TokensScreen.module.scss'

type Token = {
  id: string
  name: string
  rights: TokenRights
  createdBy: string | null
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

type Issued = Token & { token: string }

type Notice = { kind: 'done' | 'error'; text: string }

const stateTones: Record<TokenState, StatusTone> = {
  active: 'success',
  revoked: 'neutral',
}

/**
 * Доступ для ИИ — только владельцу (apps/api/src/auth/access.ts, tokens.manage): токены API для
 * MCP-сервера Averra. Выпуск с именем и правами (по умолчанию «только черновики»), токен — один
 * раз в окне вместе с фрагментом .mcp.json, список с правами и последним использованием, смена
 * прав и отзыв с подтверждением
 */
export function TokensScreen() {
  const { data: tokens } = useSuspenseQuery(tokensQuery())
  usePageTitle('Доступ для ИИ')
  const queryClient = useQueryClient()
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  const [issued, setIssued] = useState<Issued>()
  const [editing, setEditing] = useState<Token>()
  const [revoking, setRevoking] = useState<Token>()
  const [notice, setNotice] = useState<Notice>()

  const revoke = useMutation({
    mutationFn: async (token: Token) => {
      const res = await api.tokens[':id'].$delete({ param: { id: token.id } })
      if (res.status !== 204) throw await apiRequestError(res)
    },
    onSuccess: async (_, token) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tokens })
      setRevoking(undefined)
      setNotice({
        kind: 'done',
        text: `Токен «${token.name}» отозван: программа с ним больше не войдёт`,
      })
      // Кнопки строки пропали: фокус на заголовок списка, а не в никуда
      listHeadingRef.current?.focus()
    },
  })

  const columns: Column<Token>[] = [
    {
      key: 'name',
      header: 'Имя',
      wrap: 'anywhere',
      minWidth: '10rem',
      cell: (token) => (
        <span className={styles.nameCell}>
          <span className={styles.name}>{token.name}</span>
          {token.createdBy && <span className={styles.author}>выпустил {token.createdBy}</span>}
        </span>
      ),
    },
    {
      key: 'rights',
      header: 'Права',
      minWidth: '12rem',
      cell: (token) => (
        <span className={styles.rights}>
          {isDraftsOnly(token.rights) && (
            <span className={styles.draftsOnly}>Только черновики</span>
          )}
          <span>{rightsSummary(token.rights)}</span>
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Выпущен',
      muted: true,
      wrap: 'nowrap',
      cell: (token) => <time dateTime={token.createdAt}>{formatDateTime(token.createdAt)}</time>,
    },
    {
      key: 'lastUsedAt',
      header: 'Последний раз',
      muted: true,
      wrap: 'nowrap',
      cell: (token) =>
        token.lastUsedAt ? (
          <time dateTime={token.lastUsedAt} title={formatDateTime(token.lastUsedAt)}>
            {relativeTime(token.lastUsedAt)}
          </time>
        ) : (
          'не пользовались'
        ),
    },
    {
      key: 'state',
      header: 'Состояние',
      wrap: 'nowrap',
      cell: (token) => {
        const state = tokenState(token)
        return <StatusPill tone={stateTones[state]}>{tokenStateLabels[state]}</StatusPill>
      },
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">Действия</span>,
      align: 'end',
      wrap: 'nowrap',
      pinned: true,
      cell: (token) =>
        !token.revokedAt && (
          <span className={styles.actions}>
            <Button
              size="small"
              aria-label={`Права токена «${token.name}»`}
              onClick={() => {
                setNotice(undefined)
                setEditing(token)
              }}
            >
              Права
            </Button>
            <Button
              variant="danger"
              size="small"
              aria-label={`Отозвать токен «${token.name}»`}
              onClick={() => {
                setNotice(undefined)
                revoke.reset()
                setRevoking(token)
              }}
            >
              Отозвать
            </Button>
          </span>
        ),
    },
  ]

  return (
    <Screen>
      <PageHeader eyebrow="Установка" title="Доступ для ИИ" />
      <p className={styles.intro}>
        Токен — ключ, с которым нейронка через MCP-сервер Averra (Claude Code или другой клиент)
        работает с этим сайтом: читает страницы и пишет черновики. Заявок и персональных данных
        посетителей токену не видно никогда. Один токен — одна программа: так видно, кто когда
        пользовался, и отзыв не задевает остальных.
      </p>

      <Section title="Новый токен" card>
        <IssueForm
          onIssued={(token) => {
            setNotice(undefined)
            setIssued(token)
          }}
        />
      </Section>

      <Section title="Токены" headingRef={listHeadingRef}>
        <DataTable
          caption="Токены"
          columns={columns}
          rows={tokens}
          rowKey={(token) => token.id}
          minWidth="56rem"
          compact
          empty={
            <EmptyState title="Токенов пока нет" icon="key" headingLevel={3}>
              Выпустите токен формой выше и добавьте его в настройки MCP.
            </EmptyState>
          }
        />
        {notice?.kind === 'done' && (
          <InlineAlert tone="success" live>
            {notice.text}
          </InlineAlert>
        )}
        {notice?.kind === 'error' && <InlineAlert tone="danger">{notice.text}</InlineAlert>}
      </Section>

      {issued && <IssuedDialog token={issued} onClose={() => setIssued(undefined)} />}

      {editing && (
        <RightsDialog
          token={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(token) => {
            setEditing(undefined)
            setNotice({ kind: 'done', text: `Права токена «${token.name}» сохранены` })
          }}
        />
      )}

      <Dialog
        open={revoking !== undefined}
        onClose={() => setRevoking(undefined)}
        size="small"
        title={revoking ? `Отозвать токен «${revoking.name}»?` : 'Отозвать токен?'}
        description="Программа с этим токеном сразу потеряет доступ к сайту. Вернуть токен нельзя — только выпустить новый."
        footer={
          <>
            <Button onClick={() => setRevoking(undefined)}>Отмена</Button>
            <Button
              variant="danger"
              loading={revoke.isPending}
              onClick={() => revoking && revoke.mutate(revoking)}
            >
              Отозвать
            </Button>
          </>
        }
      >
        {revoke.isError && (
          <InlineAlert tone="danger">Не удалось отозвать: {messageOf(revoke.error)}</InlineAlert>
        )}
      </Dialog>
    </Screen>
  )
}

/** Флажки прав по порядку; «черновики страниц» — всегда, флажком не выключаются */
function RightsFields({
  rights,
  onChange,
}: {
  rights: TokenRights
  onChange: (rights: TokenRights) => void
}) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Права</legend>
      <p className={mutedClassName}>
        Всегда: читать сайт, создавать страницы и сохранять их черновики, загружать картинки.
      </p>
      {tokenRightOrder.map((right) => (
        <Checkbox
          key={right}
          name={right}
          label={tokenRightLabels[right]}
          hint={tokenRightHints[right]}
          checked={rights[right]}
          onChange={(event) => onChange({ ...rights, [right]: event.target.checked })}
        />
      ))}
    </fieldset>
  )
}

const fieldOrder = ['name']

function IssueForm({ onIssued }: { onIssued: (token: Issued) => void }) {
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [name, setName] = useState('')
  const [rights, setRights] = useState<TokenRights>(DRAFTS_ONLY)
  const [formError, setFormError] = useState<string>()
  const parsed = NewToken.safeParse({ name, rights })
  const form = useFormErrors(zodFieldErrors(parsed.error))

  const issue = useMutation({
    mutationFn: async (body: NewToken) => {
      const res = await api.tokens.$post({ json: body })
      if (res.status !== 201) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async (token) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tokens })
      setName('')
      // Права не «залипают»: следующий токен снова начинается с «только черновики»
      setRights(DRAFTS_ONLY)
      form.reset()
      onIssued(token)
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.issues.length > 0) {
        const errors = issueFieldErrors(error.issues)
        form.showServerErrors(errors)
        focusField(formRef.current, firstInvalidField(fieldOrder, errors))
      } else {
        setFormError(messageOf(error))
      }
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    form.attempt()
    setFormError(undefined)
    if (!parsed.success) {
      focusField(formRef.current, firstInvalidField(fieldOrder, zodFieldErrors(parsed.error)))
      return
    }
    issue.mutate({ name, rights })
  }

  return (
    <form
      ref={formRef}
      aria-label="Выпустить токен"
      className={formClassName}
      onSubmit={submit}
      noValidate
    >
      <TextInput
        label="Имя"
        name="name"
        hint="Чья это программа: «Claude Code Алексея». Имя видно в списке токенов."
        value={name}
        onChange={(event) => {
          setName(event.target.value)
          form.clearServerError('name')
        }}
        error={form.errors.name}
      />
      <RightsFields rights={rights} onChange={setRights} />
      {formError && (
        <InlineAlert tone="danger">Не удалось выпустить токен: {formError}</InlineAlert>
      )}
      <FormActions>
        <Button type="submit" variant="primary" loading={issue.isPending}>
          Выпустить токен
        </Button>
      </FormActions>
    </form>
  )
}

type CopyTarget = 'token' | 'fragment'

/**
 * Токен — один раз: окно держит его, пока открыто, а по закрытии экран его забывает. В списке и в
 * API его больше нет. Копируются токен и готовый фрагмент .mcp.json; без буфера обмена (не https)
 * текст выделяется — его копируют сочетанием клавиш
 */
function IssuedDialog({ token, onClose }: { token: Issued; onClose: () => void }) {
  const fragment = mcpConfigFragment(window.location.origin, token.token)
  const tokenRef = useRef<HTMLInputElement>(null)
  const fragmentRef = useRef<HTMLTextAreaElement>(null)
  const [copied, setCopied] = useState<{ target: CopyTarget; ok: boolean }>()

  async function copy(target: CopyTarget) {
    const text = target === 'token' ? token.token : fragment
    try {
      await navigator.clipboard.writeText(text)
      setCopied({ target, ok: true })
    } catch {
      const field = target === 'token' ? tokenRef.current : fragmentRef.current
      field?.focus()
      field?.select()
      setCopied({ target, ok: false })
    }
  }

  const copiedText = copied && {
    ok: copied.ok,
    text: copied.ok
      ? copied.target === 'token'
        ? 'Токен скопирован'
        : 'Фрагмент .mcp.json скопирован'
      : 'Браузер не дал скопировать: текст выделен, нажмите Ctrl+C (на Mac — ⌘C)',
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="large"
      title={`Токен «${token.name}» выпущен`}
      description="Токен показывается один раз: после закрытия окна его не увидит никто, даже вы. Потеряете — выпустите новый, а этот отзовите."
      footer={
        <Button variant="primary" onClick={onClose}>
          Готово, я сохранил токен
        </Button>
      }
    >
      <div className={styles.issued}>
        <p className={styles.issuedRights}>
          Права: {rightsSummary(token.rights).toLowerCase()}
          {isDraftsOnly(token.rights) && ' — только черновики, публикуете вы'}.
        </p>
        <div className={styles.copyRow}>
          <TextInput
            ref={tokenRef}
            label="Токен"
            readOnly
            value={token.token}
            className={styles.copyField}
            spellCheck={false}
            autoComplete="off"
            onFocus={(event) => event.target.select()}
          />
          <Button onClick={() => void copy('token')}>Скопировать токен</Button>
        </div>
        <TextArea
          ref={fragmentRef}
          label="Фрагмент .mcp.json"
          hint={
            <>
              Положите в <code>.mcp.json</code> в корне репозитория Averra (файл в{' '}
              <code>.gitignore</code>) и перезапустите клиент. Адрес — тот, где открыта эта админка.
              Уже есть свой <code>.mcp.json</code> — перенесите только сервер <code>averra</code>.
            </>
          }
          readOnly
          mono
          rows={12}
          value={fragment}
          spellCheck={false}
          onFocus={(event) => event.target.select()}
        />
        <FormActions>
          <Button onClick={() => void copy('fragment')}>Скопировать фрагмент .mcp.json</Button>
        </FormActions>
        <div role="status" className={styles.copyStatus}>
          {copiedText && (
            <InlineAlert tone={copiedText.ok ? 'success' : 'warning'}>
              {copiedText.text}
            </InlineAlert>
          )}
        </div>
      </div>
    </Dialog>
  )
}

function RightsDialog({
  token,
  onClose,
  onSaved,
}: {
  token: Token
  onClose: () => void
  onSaved: (token: Token) => void
}) {
  const queryClient = useQueryClient()
  const [rights, setRights] = useState<TokenRights>(token.rights)
  const changed = tokenRightOrder.some((right) => rights[right] !== token.rights[right])

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.tokens[':id'].$patch({ param: { id: token.id }, json: rights })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tokens })
      onSaved(saved)
    },
  })

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Права токена «${token.name}»`}
      description="Действуют сразу: перевыпускать токен и перезапускать MCP не нужно."
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            disabled={!changed}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Сохранить права
          </Button>
        </>
      }
    >
      <RightsFields rights={rights} onChange={setRights} />
      {save.isError && (
        <InlineAlert tone="danger">Не удалось сохранить права: {messageOf(save.error)}</InlineAlert>
      )}
    </Dialog>
  )
}
