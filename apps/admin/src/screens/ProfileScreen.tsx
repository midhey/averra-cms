import { ProfileUpdate } from '@averra/schema'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { type FormEvent, useId, useRef, useState } from 'react'
import { api } from '../api'
import { changePassword } from '../auth'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { firstInvalidField, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { ChangePasswordForm } from '../forms/password'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { currentSiteQuery, meQuery, queryKeys, sessionsQuery, siteQuery } from '../queries'
import { roleName } from '../shell/sidebar-model'
import { Button } from '../ui/Button'
import { cardClassName } from '../ui/Card'
import { useConfirm } from '../ui/Confirm'
import { TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { Facts, FormActions, formClassName, mutedClassName, Screen, Section } from '../ui/Screen'
import { usePageTitle } from '../ui/use-page-title'

type Notice = { kind: 'done' | 'error'; text: string }

/**
 * Свой профиль: имя, смена пароля и выход на других устройствах. Есть у каждого, кто вошёл, — у
 * владельца, администратора сайта и редактора. Почта — только для чтения: по ней входят
 */
export function ProfileScreen() {
  const { data: me } = useSuspenseQuery(meQuery())
  // Роль на сайте — из сайта установки, как подпись под именем в панели (загрузчик макета)
  const { data: installation } = useQuery({ ...currentSiteQuery(), retryOnMount: false })
  const site = useQuery({
    ...siteQuery(installation?.id ?? ''),
    enabled: installation !== undefined,
    retryOnMount: false,
  })
  usePageTitle('Профиль')
  if (!me) return null
  return (
    <Screen narrow>
      <PageHeader title="Профиль" meta="Ваше имя, пароль и входы в админку" />
      <Section title="Кто вы" description="Имя видно в панели слева и в письмах-приглашениях.">
        <Facts
          label="Кто вы"
          items={[
            ['Почта', me.email],
            ['Роль', roleName(me.role, site.data?.access)],
          ]}
        />
        <div className={cardClassName()}>
          <NameForm name={me.name} />
        </div>
      </Section>
      <Section
        title="Пароль"
        description="Текущий пароль и новый дважды. Остальные входы в админку после смены завершатся."
      >
        <div className={cardClassName()}>
          <PasswordForm />
        </div>
      </Section>
      <Section
        title="Входы"
        description="Админка открыта на других устройствах или в других браузерах."
      >
        <SessionsCard />
      </Section>
    </Screen>
  )
}

function NameForm({ name: current }: { name: string }) {
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const headingId = useId()
  const [name, setName] = useState(current)
  const [notice, setNotice] = useState<Notice>()
  const parsed = ProfileUpdate.safeParse({ name })
  const form = useFormErrors(zodFieldErrors(parsed.error))

  const save = useMutation({
    mutationFn: async (body: ProfileUpdate) => {
      const res = await api.me.$patch({ json: body })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: (me) => {
      // Панель слева берёт имя из того же кеша: оно меняется сразу, без перезагрузки
      queryClient.setQueryData(queryKeys.me, me.user)
      setName(me.user.name)
      form.reset()
      setNotice({ kind: 'done', text: 'Имя сохранено' })
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.issues.length > 0) {
        form.showServerErrors(issueFieldErrors(error.issues))
        focusField(formRef.current, 'name')
      } else {
        setNotice({ kind: 'error', text: `Не удалось сохранить имя: ${messageOf(error)}` })
      }
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    form.attempt()
    setNotice(undefined)
    if (!parsed.success) {
      focusField(formRef.current, 'name')
      return
    }
    save.mutate(parsed.data)
  }

  return (
    <form
      ref={formRef}
      aria-labelledby={headingId}
      className={formClassName}
      onSubmit={submit}
      noValidate
    >
      <h3 id={headingId} className="visually-hidden">
        Имя
      </h3>
      <TextInput
        label="Имя"
        name="name"
        autoComplete="name"
        value={name}
        onChange={(event) => {
          setName(event.target.value)
          setNotice(undefined)
          form.clearServerError('name')
        }}
        error={form.errors.name}
      />
      {notice?.kind === 'done' && (
        <InlineAlert tone="success" live>
          {notice.text}
        </InlineAlert>
      )}
      {notice?.kind === 'error' && <InlineAlert tone="danger">{notice.text}</InlineAlert>}
      <FormActions>
        <Button
          type="submit"
          variant="primary"
          loading={save.isPending}
          disabled={name.trim() === current}
        >
          Сохранить имя
        </Button>
      </FormActions>
    </form>
  )
}

const passwordOrder = ['currentPassword', 'password', 'repeat']

function PasswordForm() {
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const headingId = useId()
  const [values, setValues] = useState({ currentPassword: '', password: '', repeat: '' })
  const [notice, setNotice] = useState<Notice>()
  const parsed = ChangePasswordForm.safeParse(values)
  const form = useFormErrors(zodFieldErrors(parsed.error))

  const change = useMutation({
    mutationFn: changePassword,
    onSuccess: async () => {
      setValues({ currentPassword: '', password: '', repeat: '' })
      form.reset()
      setNotice({
        kind: 'done',
        text: 'Пароль изменён. Остальные входы в админку завершены, этот остался',
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.issues.length > 0) {
        // Поле API newPassword — это «Новый пароль» формы
        const errors = issueFieldErrors(
          error.issues.map((issue) =>
            issue.path === 'newPassword' ? { ...issue, path: 'password' } : issue,
          ),
        )
        form.showServerErrors(errors)
        focusField(formRef.current, firstInvalidField(passwordOrder, errors))
      } else {
        setNotice({ kind: 'error', text: messageOf(error) })
      }
    },
  })

  const set = (field: keyof typeof values) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }))
    setNotice(undefined)
    form.clearServerError(field)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    form.attempt()
    setNotice(undefined)
    if (!parsed.success) {
      focusField(formRef.current, firstInvalidField(passwordOrder, zodFieldErrors(parsed.error)))
      return
    }
    change.mutate({
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.password,
    })
  }

  return (
    <form
      ref={formRef}
      aria-labelledby={headingId}
      className={formClassName}
      onSubmit={submit}
      noValidate
    >
      <h3 id={headingId} className="visually-hidden">
        Сменить пароль
      </h3>
      {/* Подсказка менеджеру паролей: чей это пароль */}
      <input type="hidden" name="username" autoComplete="username" />
      <TextInput
        label="Текущий пароль"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        value={values.currentPassword}
        onChange={set('currentPassword')}
        error={form.errors.currentPassword}
      />
      <TextInput
        label="Новый пароль"
        name="password"
        type="password"
        autoComplete="new-password"
        value={values.password}
        onChange={set('password')}
        error={form.errors.password}
        hint="От 10 до 128 символов"
      />
      <TextInput
        label="Новый пароль ещё раз"
        name="repeat"
        type="password"
        autoComplete="new-password"
        value={values.repeat}
        onChange={set('repeat')}
        error={form.errors.repeat}
      />
      {notice?.kind === 'done' && (
        <InlineAlert tone="success" live>
          {notice.text}
        </InlineAlert>
      )}
      {notice?.kind === 'error' && <InlineAlert tone="danger">{notice.text}</InlineAlert>}
      <FormActions>
        <Button type="submit" variant="primary" loading={change.isPending}>
          Сменить пароль
        </Button>
      </FormActions>
    </form>
  )
}

/** Сколько других входов и «Выйти на других устройствах» */
function SessionsCard() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const sessions = useQuery(sessionsQuery())
  const [notice, setNotice] = useState<Notice>()
  const others = sessions.data?.others

  const revoke = useMutation({
    mutationFn: async () => {
      const res = await api.me.sessions['revoke-others'].$post()
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async ({ revoked }) => {
      setNotice({
        kind: 'done',
        text:
          revoked === 0
            ? 'Других входов не было: админка открыта только здесь'
            : `Готово: завершено входов — ${revoked}. Этот остался`,
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
    },
    onError: (error) =>
      setNotice({ kind: 'error', text: `Не удалось завершить входы: ${messageOf(error)}` }),
  })

  async function ask() {
    setNotice(undefined)
    const yes = await confirm({
      title: 'Выйти на других устройствах?',
      description:
        'Админка закроется везде, кроме этого браузера. Несохранённые правки там пропадут.',
      confirmLabel: 'Выйти на других устройствах',
      cancelLabel: 'Отмена',
    })
    if (yes) revoke.mutate()
  }

  return (
    <div className={cardClassName()}>
      <p className={mutedClassName} aria-live="polite">
        {sessions.isPending
          ? 'Считаем входы…'
          : sessions.error
            ? `Не удалось узнать, где ещё открыта админка: ${messageOf(sessions.error)}`
            : others === 0
              ? 'Админка открыта только здесь.'
              : `Кроме этого браузера, админка открыта ещё: ${others}.`}
      </p>
      {notice?.kind === 'done' && (
        <InlineAlert tone="success" live>
          {notice.text}
        </InlineAlert>
      )}
      {notice?.kind === 'error' && <InlineAlert tone="danger">{notice.text}</InlineAlert>}
      <FormActions>
        {/* Других входов нет — кнопка не кричит красным, но и не гаснет: после нажатия фокус
            остался бы на погасшей кнопке, а ответ «других входов не было» всё равно честный */}
        <Button
          variant={others === 0 ? 'secondary' : 'danger'}
          loading={revoke.isPending}
          onClick={() => void ask()}
        >
          Выйти на других устройствах
        </Button>
      </FormActions>
    </div>
  )
}
