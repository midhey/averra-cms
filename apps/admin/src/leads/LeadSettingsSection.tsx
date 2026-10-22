import { LeadSettings } from '@averra/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type FormEvent, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { firstInvalidField, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { leadSettingsQuery, queryKeys } from '../queries'
import { Button } from '../ui/Button'
import { Checkbox, TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { FormActions, formClassName, mutedClassName, Section } from '../ui/Screen'

type Notice = { kind: 'done' | 'error'; text: string }

const fieldOrder = ['retentionDays']

/**
 * Настройки заявок сайта: сколько хранить и письмо посетителю. Куда уходят уведомления о заявках —
 * в разделе «Уведомления» (почта и Telegram)
 */
export function LeadSettingsSection({ siteId, id }: { siteId: string; id?: string }) {
  const { data: saved } = useSuspenseQuery(leadSettingsQuery(siteId))
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [retentionDays, setRetentionDays] = useState(String(saved.retentionDays))
  const [confirmToVisitor, setConfirmToVisitor] = useState(saved.confirmToVisitor)
  const [notice, setNotice] = useState<Notice>()

  const parsed = LeadSettings.safeParse({
    retentionDays: Number(retentionDays),
    confirmToVisitor,
  })
  const form = useFormErrors(zodFieldErrors(parsed.error))

  const save = useMutation({
    mutationFn: async (body: LeadSettings) => {
      const res = await api.sites[':siteId'].leads.settings.$put({ param: { siteId }, json: body })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async (settings) => {
      setRetentionDays(String(settings.retentionDays))
      await queryClient.invalidateQueries({ queryKey: queryKeys.leads(siteId) })
      setNotice({ kind: 'done', text: 'Настройки заявок сохранены' })
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.issues.length > 0) {
        form.showServerErrors(issueFieldErrors(error.issues))
      } else {
        setNotice({ kind: 'error', text: `Не удалось сохранить: ${messageOf(error)}` })
      }
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    form.attempt()
    setNotice(undefined)
    if (!parsed.success) {
      focusField(formRef.current, firstInvalidField(fieldOrder, zodFieldErrors(parsed.error)))
      return
    }
    save.mutate(parsed.data)
  }

  return (
    <Section
      id={id}
      title="Заявки"
      description="Сколько хранить заявки и подтверждать ли посетителю: в заявках персональные данные посетителей."
      card
    >
      <p className={mutedClassName}>
        Куда приходят уведомления о новых заявках — почта и Telegram —{' '}
        <Link to="/notifications">в разделе «Уведомления»</Link>.
      </p>
      <form
        ref={formRef}
        aria-label="Настройки заявок"
        className={formClassName}
        onSubmit={submit}
        noValidate
      >
        <TextInput
          label="Хранить заявки, дней"
          name="retentionDays"
          inputMode="numeric"
          value={retentionDays}
          onChange={(event) => {
            setRetentionDays(event.target.value)
            form.clearServerError('retentionDays')
          }}
          error={form.errors.retentionDays}
          hint="От 7 до 1825. Старые заявки удаляются сами: в них персональные данные посетителей"
        />
        <Checkbox
          name="confirmToVisitor"
          checked={confirmToVisitor}
          onChange={(event) => setConfirmToVisitor(event.target.checked)}
          label="Отправлять посетителю письмо «Заявка получена»"
          hint="Если он оставил почту. Текст постоянный, без того, что он ввёл; не чаще раза в сутки на адрес"
        />
        {notice?.kind === 'error' && <InlineAlert tone="danger">{notice.text}</InlineAlert>}
        <FormActions>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Сохранить настройки
          </Button>
        </FormActions>
        {notice?.kind === 'done' && (
          <InlineAlert tone="success" live>
            {notice.text}
          </InlineAlert>
        )}
      </form>
    </Section>
  )
}
