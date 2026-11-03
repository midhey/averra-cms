import { roleLabels } from '@averra/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useRef, useState } from 'react'
import { api } from '../api'
import { apiRequestError, messageOf } from '../errors'
import { assignableRoles, canManageMember, type SiteAccess } from '../permissions'
import { membersQuery, queryKeys } from '../queries'
import { Button } from '../ui/Button'
import { useConfirm } from '../ui/Confirm'
import { type Column, DataTable } from '../ui/DataTable'
import { Dialog } from '../ui/Dialog'
import { EmptyState } from '../ui/EmptyState'
import { Checkbox } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { mutedClassName } from '../ui/Screen'
import { SegmentedControl } from '../ui/SegmentedControl'
import { StatusPill } from '../ui/StatusPill'
import styles from './InvitationsSection.module.scss'
import { roleHints } from './invitation-format'

type Member = {
  id: string
  name: string
  email: string
  role: SiteAccess | null
  /** Роль до отключения: кто может вернуть доступ и что предложить в окне */
  disabledRole: SiteAccess | null
  status: 'active' | 'disabled'
  self: boolean
}

type Notice = { kind: 'done' | 'error'; text: string }

/** Окно, открытое над таблицей: роль участника или возврат доступа */
type Open = { kind: 'role' | 'restore'; member: Member } | undefined

/**
 * Кто работает с сайтом: владельцы, администраторы сайта, редакторы и отключённые. Роль,
 * отключение, возврат доступа и передача владения — здесь, без команд на сервере. Кого можно
 * трогать, решает API (assignableRoles в access.ts), а таблица только не предлагает лишнего:
 * свою строку не меняет никто, администратор сайта — только редакторов
 */
export function MembersTable({ siteId, access }: { siteId: string; access: SiteAccess }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const members = useQuery({ ...membersQuery(siteId), retryOnMount: false })
  const [open, setOpen] = useState<Open>()
  const [notice, setNotice] = useState<Notice>()
  const assignable = assignableRoles[access]

  // Роль поменялась — могли поменяться и права вошедшего (передача владения): меню, сайт и
  // участники перечитываются
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.members(siteId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.invitations(siteId) }),
    ])

  const disable = useMutation({
    mutationFn: async (member: Member) => {
      const res = await api.sites[':siteId'].members[':userId'].disable.$post({
        param: { siteId, userId: member.id },
      })
      if (res.status !== 200) throw await apiRequestError(res)
    },
    onSuccess: async (_, member) => {
      await refresh()
      setNotice({
        kind: 'done',
        text: `Доступ для ${member.name} отключён: все входы этого человека завершены`,
      })
      headingRef.current?.focus()
    },
    onError: (error, member) =>
      setNotice({
        kind: 'error',
        text: `Не удалось отключить доступ для ${member.name}: ${messageOf(error)}`,
      }),
  })

  async function askDisable(member: Member) {
    setNotice(undefined)
    const yes = await confirm({
      title: `Отключить доступ для ${member.name}?`,
      description:
        'Все входы этого человека в админку завершатся сразу, войти снова не получится. Вернуть доступ можно здесь же.',
      confirmLabel: 'Отключить доступ',
      cancelLabel: 'Оставить',
    })
    if (yes) disable.mutate(member)
  }

  const columns: Column<Member>[] = [
    {
      key: 'name',
      header: 'Имя',
      minWidth: '8rem',
      wrap: 'anywhere',
      cell: (member) => (
        <span className={styles.memberName}>
          {member.name}
          {member.self && <span className={mutedClassName}>это вы</span>}
        </span>
      ),
    },
    {
      key: 'email',
      header: 'Почта',
      wrap: 'anywhere',
      minWidth: '10rem',
      muted: true,
      cell: (member) => member.email,
    },
    {
      key: 'role',
      header: 'Роль',
      // «Администратор сайта» переносится между словами: в одну строку таблица не помещалась
      cell: (member) =>
        member.role ? (
          roleLabels[member.role]
        ) : member.disabledRole ? (
          <span className={mutedClassName}>до отключения: {roleLabels[member.disabledRole]}</span>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: 'Состояние',
      wrap: 'nowrap',
      cell: (member) =>
        member.status === 'active' ? (
          <StatusPill tone="success">Действует</StatusPill>
        ) : (
          <StatusPill tone="neutral">Отключён</StatusPill>
        ),
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">Действия</span>,
      align: 'end',
      wrap: 'nowrap',
      pinned: true,
      cell: (member) => {
        if (member.self || !canManageMember(access, member.role, member.disabledRole)) {
          return null
        }
        if (member.role === null) {
          return (
            <Button
              size="small"
              aria-label={`Вернуть доступ: ${member.name}`}
              onClick={() => {
                setNotice(undefined)
                setOpen({ kind: 'restore', member })
              }}
            >
              Вернуть доступ
            </Button>
          )
        }
        return (
          <span className={styles.actions}>
            {/* Администратору сайта выбирать не из чего: он назначает только редакторов */}
            {assignable.length > 1 && (
              <Button
                size="small"
                aria-label={`Роль: ${member.name}`}
                onClick={() => {
                  setNotice(undefined)
                  setOpen({ kind: 'role', member })
                }}
              >
                Роль
              </Button>
            )}
            <Button
              size="small"
              variant="danger"
              aria-label={`Отключить доступ: ${member.name}`}
              disabled={disable.isPending}
              onClick={() => void askDisable(member)}
            >
              Отключить
            </Button>
          </span>
        )
      },
    },
  ]

  return (
    <div className={styles.members}>
      <h3 ref={headingRef} tabIndex={-1} className={styles.subtitle}>
        Кто работает с сайтом
      </h3>
      {members.error && (
        <InlineAlert
          tone="danger"
          action={
            <Button
              size="small"
              loading={members.isFetching}
              onClick={() => void members.refetch()}
            >
              Повторить
            </Button>
          }
        >
          Не удалось загрузить участников: {messageOf(members.error)}
        </InlineAlert>
      )}
      {members.isPending && <p className={mutedClassName}>Загружаем участников…</p>}
      {members.data && (
        <DataTable
          caption="Участники сайта"
          columns={columns}
          rows={members.data}
          rowKey={(member) => member.id}
          minWidth="44rem"
          compact
          empty={
            <EmptyState title="Участников пока нет" icon="user" headingLevel={3}>
              Пригласите человека формой ниже.
            </EmptyState>
          }
        />
      )}
      {notice?.kind === 'done' && (
        <InlineAlert tone="success" live>
          {notice.text}
        </InlineAlert>
      )}
      {notice?.kind === 'error' && <InlineAlert tone="danger">{notice.text}</InlineAlert>}

      <RoleDialog
        siteId={siteId}
        access={access}
        open={open}
        onClose={() => setOpen(undefined)}
        onDone={async (text) => {
          setOpen(undefined)
          await refresh()
          setNotice({ kind: 'done', text })
          headingRef.current?.focus()
        }}
      />
    </div>
  )
}

/**
 * Окно «Роль» (у действующего) и «Вернуть доступ» (у отключённого): выбор из ролей, которые
 * вошедший может выдать. Роль «Владелец» — с предупреждением и флажком «Передать владение»:
 * тогда он владелец, а вошедший — администратор сайта
 */
function RoleDialog({
  siteId,
  access,
  open,
  onClose,
  onDone,
}: {
  siteId: string
  access: SiteAccess
  open: Open
  onClose: () => void
  onDone: (text: string) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const formId = useId()
  const member = open?.member
  const restoring = open?.kind === 'restore'
  const assignable = assignableRoles[access]
  const [role, setRole] = useState<SiteAccess>('editor')
  const [transfer, setTransfer] = useState(false)
  const [error, setError] = useState<string>()
  const [shownFor, setShownFor] = useState<Open>()

  // Окно открылось для другого участника — роль из его строки, флажок снят, ошибки нет
  if (open !== shownFor) {
    setShownFor(open)
    // У отключённого — роль до отключения, если вошедший может её выдать
    const previous = open?.member.role ?? open?.member.disabledRole
    setRole(
      previous && assignable.includes(previous)
        ? previous
        : assignable.includes('editor')
          ? 'editor'
          : 'client',
    )
    setTransfer(false)
    setError(undefined)
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!member) throw new Error('Участник не выбран')
      const param = { siteId, userId: member.id }
      const endpoint = api.sites[':siteId'].members[':userId']
      if (transfer) {
        const res = await endpoint.transfer.$post({ param })
        if (res.status !== 200) throw await apiRequestError(res)
        // Вошедший больше не владелец: меню, сайт и «Установка» перечитываются
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.me }),
          queryClient.invalidateQueries({ queryKey: queryKeys.site(siteId) }),
        ])
        return (await res.json()).message
      }
      const res = restoring
        ? await endpoint.restore.$post({ param, json: { role } })
        : await endpoint.$patch({ param, json: { role } })
      if (res.status !== 200) throw await apiRequestError(res)
      return restoring
        ? `Доступ для ${member.name} возвращён: роль «${roleLabels[role]}»`
        : `${member.name}: роль «${roleLabels[role]}». Меню у него поменяется при следующем переходе`
    },
    onSuccess: (text) => onDone(text),
    onError: (failure) => setError(messageOf(failure)),
  })

  if (!member) return null
  const toOwner = role === 'owner'
  const unchanged = !restoring && role === member.role
  const submitLabel = transfer
    ? 'Передать владение'
    : restoring
      ? 'Вернуть доступ'
      : toOwner
        ? 'Сделать владельцем'
        : 'Сменить роль'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    save.mutate()
  }

  return (
    <Dialog
      open={open !== undefined}
      onClose={onClose}
      title={restoring ? `Вернуть доступ: ${member.name}` : `Роль: ${member.name}`}
      description={member.email}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            type="submit"
            form={formId}
            variant={toOwner ? 'danger' : 'primary'}
            loading={save.isPending}
            disabled={unchanged && !transfer}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className={styles.roleForm}>
        <SegmentedControl
          legend="Роль"
          name="role"
          appearance="list"
          options={assignable.map((value) => ({
            value,
            label: roleLabels[value],
            description: roleHints[value],
          }))}
          value={role}
          onChange={(value) => {
            setRole(value)
            if (value !== 'owner') setTransfer(false)
          }}
        />
        {toOwner && (
          <InlineAlert tone="warning" title="Владелец может всё">
            Код своих блоков, тему, токены для ИИ, обновление установки, участников — и сможет
            понизить или отключить других владельцев, в том числе вас.
          </InlineAlert>
        )}
        {/* Тот уже владелец — передавать нечего: окно предлагает только сменить ему роль */}
        {toOwner && !restoring && access === 'owner' && member.role !== 'owner' && (
          <Checkbox
            label="Передать владение"
            hint={`Ваша роль станет «${roleLabels.client}»: «Установка» и «Свои блоки» у вас пропадут`}
            checked={transfer}
            onChange={(event) => setTransfer(event.target.checked)}
          />
        )}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </form>
    </Dialog>
  )
}
